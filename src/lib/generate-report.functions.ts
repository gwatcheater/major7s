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

OUTPUT: JSON only: { "title": string, "body": string } where body is Markdown.
No preamble, no code fences.`;

/**
 * Trim the StatsPack down to what the model can actually use in a short post.
 * Sending the full pack wastes tokens on 93 popularity rows and ~12,000
 * combination subsets, and encourages the model to pad the post with detail
 * the reader does not want. Team ids are resolved to nicknames here so the
 * model never sees a uuid.
 */
function summariseForPrompt(pack: StatsPack) {
  const nameOf = (id: string) => pack.teamNames[id] ?? "Unknown";
  return {
    entries: pack.entryCount,
    fieldSize: pack.fieldSize,
    distinctPicked: pack.distinctPicked,
    untouched: pack.fieldSize - pack.distinctPicked,
    mostPopular: pack.mostPopular.slice(0, 10).map((p) => ({
      golfer: p.name,
      owgr: p.owgr,
      bucket: p.bucket,
      picks: p.count,
      share: pack.entryCount ? Math.round((p.count / pack.entryCount) * 100) : 0,
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
      })),
    },
    wolf: {
      rarest: pack.wolf.rarestTeamId ? nameOf(pack.wolf.rarestTeamId) : null,
      rarestAvg: Number(pack.wolf.min.toFixed(1)),
      chalkiest: pack.wolf.chalkiestTeamId ? nameOf(pack.wolf.chalkiestTeamId) : null,
      chalkiestAvg: Number(pack.wolf.max.toFixed(1)),
      median: Number(pack.wolf.median.toFixed(1)),
    },
    uniquePicks: {
      total: pack.uniqueTotal,
      // The interesting ones: highly ranked golfers with a single backer.
      notableOneManBets: pack.uniqueByBucket
        .flatMap((u) => u.items)
        .filter((i) => (i.owgr ?? 9999) <= 20)
        .map((i) => ({ golfer: i.name, owgr: i.owgr, backedBy: nameOf(i.teamId) })),
    },
    identicalTeams: pack.overlap.identical.map((g) => g.map(nameOf)),
    avgOverlap: Number(pack.overlap.avg.toFixed(2)),
    timings: {
      firstIn: pack.timings.first ? nameOf(pack.timings.first.teamId) : null,
      firstInAt: pack.timings.first ? new Date(pack.timings.first.submitted).toISOString() : null,
      lastIn: pack.timings.last ? nameOf(pack.timings.last.teamId) : null,
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
        stats: summariseForPrompt(pack),
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

        // The model is told to return bare JSON, but strip fences defensively.
        const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        title = String(parsed.title ?? "").trim();
        body = String(parsed.body ?? "").trim();
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
