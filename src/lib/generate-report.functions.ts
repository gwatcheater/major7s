import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildStatsPack } from "@/lib/stats/buildStatsPack";
import type { Golfer, Pick, StatsPack, Team } from "@/lib/stats/types";

// =====================================================================
// !! VERIFY THESE TWO CONSTANTS BEFORE FIRST RUN !!
//
// There is no existing LLM call anywhere in this repo, so this is the one
// contract I could not copy from an established pattern. LOVABLE_API_KEY is
// already present as a secret (currently only used for inbound webhook auth
// in src/routes/lovable/email/**). The gateway is OpenAI-compatible.
//
// If generation 401s or 404s, it is almost certainly one of these two lines
// and nothing else in the file.
// =====================================================================
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

const ReportType = z.enum(["picks_closed", "r1", "r2", "r3", "final"]);

const InputSchema = z.object({
  tournamentId: z.string().uuid(),
  reportType: ReportType,
  colourNotes: z.string().trim().max(4000).optional().default(""),
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: roleRow, error: roleErr } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleErr) throw new Error(roleErr.message);
  if (!roleRow) throw new Error("Forbidden: admin role required");
}

/**
 * Supabase silently caps result sets at 1,000 rows with no error.
 * picks is 8,708 rows across all tournaments and ~880 for a single event at
 * 126 entries, so this is already live at 143 entries. Page exhaustively.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message ?? String(error));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

const SYSTEM_PROMPT = `ROLE: Master of ceremonies for the Major7s fantasy golf pool. Hyper-literate,
aggressively cynical, data-obsessed. Audience: close golf-nerd friends who thrive
on psychological warfare. Every sentence delivers a sharp insight. Eradicate
sports cliches.

VOICE: British-inflected satire. High-vocabulary prose welded to group-chat wit.
Atomic brevity: short, punchy sentences. Heavy bolding.

LENGTH: SHORT. Lead with the single biggest headline in the first two paragraphs.
Readers switch off at detail. Do not explain methodology. Close by directing
readers to the tournament stats page for the full breakdown.

STRUCTURE for a Picks Closed report:
1. Opening: the 2-3 biggest headlines from the pick data. No heading.
2. "## What it takes to win {family}" - the winning score history, the average,
   the all-time best and all-time worst records.
3. "## Welcome to the debutants" - list every debutant team nickname exactly.
4. "## Fun facts" - quickest entry, last in, most tweaks, last-minute change.
5. Closing line pointing at the stats page.

WHERE THE STORY IS: the data object contains a "crossovers" section. These are
pre-computed connections between different statistics and they are the most
interesting thing you have been given. A team that is both the first entry in
and the closest to the herd is a character sketch. A debutant with the rarest
picks in the pool is a story. Use them.

"rankedButIgnored" shows how many teams picked each of the world's best golfers.
Where the pool has ignored a high-ranked player in favour of a lower-ranked one,
say so plainly: it is the sharpest thing in the dataset.

Never state a number that is not in the data object. Never soften a finding to
be kind. Never pad with statistics that carry no story.

TERMINOLOGY (NON-NEGOTIABLE):
- A team's golfer selection is "picks". Never "roster". Never "card".
- Use "picked" / "picks". Never "owned" / "owning".
- Always "Major7s". Never "M7".
- Tied positions are T{Pos}, e.g. T104. Never "=104".
- Shorten "through the cut" to "Thru Cut" or "Thru".
- Never invent nicknames for entrants. Use their exact team name as supplied.
- British English. No em dashes: use hyphens.

FORMATTING:
- Markdown only. NO raw HTML and NO SVG: the renderer strips them silently.
- The column is narrow (672px). Tables must be 4 columns maximum. Prefer prose.
- For simple comparisons you may use text bars, e.g.
  2023  ####################  102
- Do not use images.

DATA: You are given a StatsPack of pre-computed verified statistics, a context
object of records and debutants, and free-text colour notes from the admin.
Use ONLY numbers present in those objects. Never invent, estimate, or infer a
statistic. If a number is not given to you, do not state it. The colour notes
are the only source of real-world context: weave them in, do not just repeat them.

OUTPUT: Return exactly this format and nothing else. No JSON, no code fences,
no preamble, no commentary:

TITLE: <the title on one line>
BODY:
<the post in Markdown>`;

/**
 * Trim the StatsPack down to what the model can actually use, and compute the
 * cross-panel connections that make a post readable.
 *
 * Sending the raw pack wastes tokens on 93 popularity rows and ~12,000
 * combination subsets, and encourages the model to pad. Team ids are resolved
 * to nicknames here so the model never sees a uuid it could mangle.
 *
 * `reportContext` is the major7s_report_context RPC payload. It is passed in so
 * crossovers can span both sources: "this debutant has the rarest picks" needs
 * the debutant list from the RPC and the wolf index from the pack.
 */
function summariseForPrompt(pack: StatsPack, reportContext: any) {
  const nameOf = (id: string) => pack.teamNames[id] ?? "Unknown";
  const share = (n: number) => (pack.entryCount ? Math.round((n / pack.entryCount) * 100) : 0);

  const debutantNames = new Set<string>(
    Array.isArray(reportContext?.debutants)
      ? reportContext.debutants.map((d: any) => String(d.nickname ?? "").trim())
      : [],
  );

  // Golfers the world rates that the pool may not. The sharpest tension there is.
  const rankedButIgnored = [...pack.mostPopular]
    .filter((p) => (p.owgr ?? 9999) <= 15)
    .sort((a, b) => (a.owgr ?? 9999) - (b.owgr ?? 9999))
    .map((p) => ({
      golfer: p.name,
      owgr: p.owgr,
      picks: p.count,
      share: share(p.count),
    }));

  // Teams holding more than one golfer nobody else has.
  const uniqueCountByTeam = new Map<string, number>();
  pack.uniqueByBucket
    .flatMap((u) => u.items)
    .forEach((i) => uniqueCountByTeam.set(i.teamId, (uniqueCountByTeam.get(i.teamId) ?? 0) + 1));
  const multiUniqueTeams = Array.from(uniqueCountByTeam.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([teamId, n]) => ({ team: nameOf(teamId), uniques: n }));

  // ---- crossovers: the connections, not the columns --------------------
  const crossovers: string[] = [];

  const firstIn = pack.timings.first ? nameOf(pack.timings.first.teamId) : null;
  const lastIn = pack.timings.last ? nameOf(pack.timings.last.teamId) : null;
  const rarest = pack.wolf.rarestTeamId ? nameOf(pack.wolf.rarestTeamId) : null;
  const chalkiest = pack.wolf.chalkiestTeamId ? nameOf(pack.wolf.chalkiestTeamId) : null;
  const closestToHerd = pack.herd.closest[0] ? nameOf(pack.herd.closest[0].teamId) : null;
  const biggestTweaker = pack.timings.tweakers[0] ? nameOf(pack.timings.tweakers[0].teamId) : null;
  const lastEditor = pack.timings.editors[0] ? nameOf(pack.timings.editors[0].teamId) : null;

  if (firstIn && closestToHerd && firstIn === closestToHerd) {
    crossovers.push(
      `${firstIn} was the first entry submitted AND matches the herd in ${pack.herd.closest[0].matched} of 7 buckets. Straight down the middle, straight away.`,
    );
  }
  if (firstIn && chalkiest && firstIn === chalkiest) {
    crossovers.push(
      `${firstIn} was the first entry in AND has the most popular picks in the pool (${pack.wolf.max.toFixed(1)} average backers).`,
    );
  }
  if (rarest && debutantNames.has(rarest)) {
    crossovers.push(
      `${rarest} is a DEBUTANT and already has the rarest picks in the pool (${pack.wolf.min.toFixed(1)} average backers vs a median of ${pack.wolf.median.toFixed(1)}). A first-timer who ignored the entire herd.`,
    );
  }
  if (chalkiest && debutantNames.has(chalkiest)) {
    crossovers.push(
      `${chalkiest} is a DEBUTANT and has gone straight for the chalk (${pack.wolf.max.toFixed(1)} average backers).`,
    );
  }
  if (rarest && pack.wolf.rarestTeamId && (uniqueCountByTeam.get(pack.wolf.rarestTeamId) ?? 0) === 0) {
    crossovers.push(
      `${rarest} has the rarest picks in the pool but ZERO unique picks. Not a gambler: just seven unfashionable names nobody else fancied.`,
    );
  }
  if (biggestTweaker && lastEditor && biggestTweaker === lastEditor) {
    crossovers.push(
      `${biggestTweaker} changed their picks more than anyone (${pack.timings.tweakers[0].tweaks} times) AND was the last to stop fiddling.`,
    );
  }
  if (biggestTweaker && (uniqueCountByTeam.get(pack.timings.tweakers[0].teamId) ?? 0) > 0) {
    crossovers.push(
      `${biggestTweaker} tweaked ${pack.timings.tweakers[0].tweaks} times and ended up with ${uniqueCountByTeam.get(pack.timings.tweakers[0].teamId)} unique pick(s) nobody else has.`,
    );
  }
  if (lastIn && rarest && lastIn === rarest) {
    crossovers.push(`${lastIn} left it latest of anyone AND ended up with the rarest picks.`);
  }
  pack.overlap.identical.forEach((group) => {
    const names = group.map(nameOf);
    crossovers.push(
      `${names.join(" and ")} submitted byte-identical picks, all 7. The average overlap between any two entries is ${pack.overlap.avg.toFixed(2)} of 7, so this is roughly ${(7 / Math.max(pack.overlap.avg, 0.01)).toFixed(1)}x the expected overlap.`,
    );
  });
  const emptyBuckets = pack.bucketConcentration.filter((b) => b.available - b.picked > 0);
  const worstBucket = [...emptyBuckets].sort(
    (a, b) => b.available - b.picked - (a.available - a.picked),
  )[0];
  if (worstBucket) {
    crossovers.push(
      `Bucket ${worstBucket.bucket} has ${worstBucket.available - worstBucket.picked} golfers with no backer at all, out of ${worstBucket.available} available. The pool barely looked at it.`,
    );
  }
  if (pack.herd.anyPerfect === false && closestToHerd) {
    crossovers.push(
      `Nobody picked the full herd team. ${closestToHerd} came closest at ${pack.herd.closest[0].matched} of 7.`,
    );
  }
  multiUniqueTeams.slice(0, 3).forEach((t) => {
    crossovers.push(
      `${t.team} is holding ${t.uniques} golfers that nobody else picked. If either lands, they gain on the entire field at once.`,
    );
  });

  return {
    entries: pack.entryCount,
    fieldSize: pack.fieldSize,
    distinctPicked: pack.distinctPicked,
    untouched: pack.fieldSize - pack.distinctPicked,

    crossovers,

    rankedButIgnored,

    mostPopular: pack.mostPopular.slice(0, 10).map((p) => ({
      golfer: p.name,
      owgr: p.owgr,
      bucket: p.bucket,
      picks: p.count,
      share: share(p.count),
    })),

    bucketCoverage: pack.bucketConcentration.map((b) => ({
      bucket: b.bucket,
      picked: b.picked,
      available: b.available,
      untouched: b.available - b.picked,
      mostPicked: b.topName,
      mostPickedCount: b.topCount,
      uniques: b.uniques,
    })),

    herd: {
      team: pack.herd.modal.map((m) => ({ bucket: m.bucket, golfer: m.name, picks: m.count })),
      nobodyPickedAllSeven: !pack.herd.anyPerfect,
      closest: pack.herd.closest.slice(0, 3).map((c) => ({
        team: nameOf(c.teamId),
        matched: c.matched,
        deviatesInBuckets: c.deviates,
      })),
    },

    wolf: {
      rarest,
      rarestAvg: Number(pack.wolf.min.toFixed(1)),
      chalkiest,
      chalkiestAvg: Number(pack.wolf.max.toFixed(1)),
      median: Number(pack.wolf.median.toFixed(1)),
      timesRarerThanChalkiest: Number(pack.wolf.ratio.toFixed(1)),
      teamsUnder15: pack.wolf.under15,
      teamsOver30: pack.wolf.over30,
    },

    popularCombinations: pack.comboSections.map((sec) => ({
      size: sec.k,
      top: sec.entries.slice(0, 2).map((e) => ({
        golfers: e.names,
        teams: e.teamIds.length,
        share: share(e.teamIds.length),
        backedBy: e.teamIds.length <= 6 ? e.teamIds.map(nameOf) : undefined,
      })),
    })),

    uniquePicks: {
      total: pack.uniqueTotal,
      notableOneManBets: pack.uniqueByBucket
        .flatMap((u) => u.items)
        .filter((i) => (i.owgr ?? 9999) <= 20)
        .map((i) => ({ golfer: i.name, owgr: i.owgr, backedBy: nameOf(i.teamId) })),
      multiUniqueTeams,
    },

    identicalTeams: pack.overlap.identical.map((g) => g.map(nameOf)),
    nearIdenticalPairs: pack.overlap.near
      .slice(0, 4)
      .map((n) => ({ teams: [nameOf(n.a), nameOf(n.b)], shared: n.shared })),
    avgOverlap: Number(pack.overlap.avg.toFixed(2)),

    timings: {
      firstIn,
      firstInAt: pack.timings.first ? new Date(pack.timings.first.submitted).toISOString() : null,
      lastIn,
      lastInAt: pack.timings.last ? new Date(pack.timings.last.submitted).toISOString() : null,
      mostTweaks: pack.timings.tweakers.slice(0, 3).map((t) => ({
        team: nameOf(t.teamId),
        tweaks: t.tweaks,
      })),
      lastToChangeTheirMind: pack.timings.editors[0]
        ? {
            team: nameOf(pack.timings.editors[0].teamId),
            at: new Date(pack.timings.editors[0].edited).toISOString(),
          }
        : null,
      neverChanged: pack.timings.untouched,
      total: pack.timings.total,
    },
  };
}

export const generateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; title: string; body: string } | { ok: false; error: string }> => {
      await assertAdmin(context);

      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY is not configured" };

      // ---- tournament ------------------------------------------------
      const { data: tournament, error: tErr } = await supabaseAdmin
        .from("tournaments")
        .select("id, name, location, start_date, status, submission_deadline")
        .eq("id", data.tournamentId)
        .maybeSingle();
      if (tErr) return { ok: false, error: tErr.message };
      if (!tournament) return { ok: false, error: "Tournament not found" };

      // Picks change until the deadline. Generating before it produces a post
      // whose numbers are stale the moment it publishes.
      if (data.reportType === "picks_closed" && tournament.submission_deadline) {
        if (new Date(tournament.submission_deadline).getTime() > Date.now()) {
          return {
            ok: false,
            error: "Picks are still open. Generate the Picks Closed report after the deadline.",
          };
        }
      }

      // ---- stats -----------------------------------------------------
      let pack: StatsPack;
      try {
        const picks = await fetchAll<Pick>((from, to) =>
          supabaseAdmin
            .from("picks")
            .select("team_id, bucket, golfer_id, submitted_at, last_edited_at, tweak_count")
            .eq("tournament_id", data.tournamentId)
            .range(from, to),
        );
        if (picks.length === 0) return { ok: false, error: "No picks for this tournament" };

        const golfers = await fetchAll<Golfer>((from, to) =>
          supabaseAdmin
            .from("golfers")
            .select("id, golfer_name, owgr_rank, bucket_number")
            .eq("tournament_id", data.tournamentId)
            .range(from, to),
        );

        const teamIds = Array.from(new Set(picks.map((p) => p.team_id)));
        const teams: Team[] = [];
        for (let i = 0; i < teamIds.length; i += 200) {
          // .in() with a long uuid list can exceed URL length. Chunk it.
          const { data: chunk, error } = await supabaseAdmin
            .from("teams")
            .select("id, nickname")
            .in("id", teamIds.slice(i, i + 200));
          if (error) return { ok: false, error: error.message };
          teams.push(...((chunk ?? []) as Team[]));
        }

        pack = buildStatsPack(picks, golfers, teams);
      } catch (e: any) {
        return { ok: false, error: `Stats failed: ${e?.message ?? String(e)}` };
      }

      // ---- records + debutants --------------------------------------
      const { data: reportContext, error: rpcErr } = await (supabaseAdmin as any).rpc(
        "major7s_report_context",
        { p_tournament_id: data.tournamentId },
      );
      if (rpcErr) return { ok: false, error: `Records failed: ${rpcErr.message}` };

      // ---- prompt ----------------------------------------------------
      const payload = {
        reportType: data.reportType,
        tournament: {
          name: tournament.name,
          location: tournament.location,
          startDate: tournament.start_date,
        },
        stats: summariseForPrompt(pack, reportContext),
        records: reportContext,
        colourNotes: data.colourNotes || "(none supplied)",
      };

      // ---- generate --------------------------------------------------
      let title = "";
      let body = "";
      try {
        const res = await fetch(AI_GATEWAY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Write the ${data.reportType} report.\n\n${JSON.stringify(payload, null, 2)}`,
              },
            ],
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          return { ok: false, error: `AI gateway ${res.status}: ${detail.slice(0, 300)}` };
        }

        const json = await res.json();
        const raw: string = json?.choices?.[0]?.message?.content ?? "";
        if (!raw) return { ok: false, error: "AI gateway returned an empty response" };

        // Deliberately NOT JSON. A markdown body is mostly newlines, and models
        // routinely emit them unescaped inside JSON strings, which is invalid
        // and blows up JSON.parse ("Bad control character in string literal").
        // A delimiter has no escaping rules to get wrong.
        const cleaned = raw
          .replace(/^```(?:\w+)?\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();

        const titleMatch = cleaned.match(/^\s*TITLE:\s*(.+?)\s*$/m);
        const bodyIndex = cleaned.search(/^\s*BODY:\s*$/m);

        if (titleMatch && bodyIndex !== -1) {
          title = titleMatch[1].trim();
          body = cleaned
            .slice(bodyIndex)
            .replace(/^\s*BODY:\s*$/m, "")
            .trim();
        } else {
          // Model ignored the format. Salvage rather than fail and waste the
          // call: first non-empty line is the title, everything after is body.
          const lines = cleaned.split("\n");
          const firstIdx = lines.findIndex((l) => l.trim());
          title = (lines[firstIdx] ?? "")
            .replace(/^#+\s*/, "")
            .replace(/^TITLE:\s*/i, "")
            .trim();
          body = lines
            .slice(firstIdx + 1)
            .join("\n")
            .replace(/^\s*BODY:\s*$/m, "")
            .trim();
        }

        if (!title || !body) return { ok: false, error: "AI returned no title or body" };
      } catch (e: any) {
        return { ok: false, error: `Generation failed: ${e?.message ?? String(e)}` };
      }

      await supabaseAdmin.from("admin_audit").insert({
        actor_id: context.userId,
        action: "blog.report_generated",
        detail: {
          tournament_id: data.tournamentId,
          tournament: tournament.name,
          report_type: data.reportType,
          entries: pack.entryCount,
          model: AI_MODEL,
          had_colour_notes: Boolean(data.colourNotes),
        },
      });

      // Deliberately does NOT insert into blog_posts. blog_posts has no draft
      // column, so any insert is instantly live to every signed-in user.
      // Publishing stays an explicit second click by the admin.
      return { ok: true, title, body };
    },
  );
