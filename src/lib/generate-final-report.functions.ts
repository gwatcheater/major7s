import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildFinalPack } from "@/lib/stats/buildFinalPack";
import type { Golfer, Pick, Team } from "@/lib/stats/types";
import type { FinalPack, LeaderboardRow, ScoreRow } from "@/lib/stats/final-types";

// =====================================================================
// Shares the gateway/site constants with generate-report.functions.ts. If you
// centralise those (e.g. src/lib/ai/config.ts), import from there instead of
// duplicating. Kept inline here so this file stands alone.
//
// !! Same two constants to verify as the picks-closed function. Proven working.
// =====================================================================
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const PUBLIC_SITE_ORIGIN = "https://www.major7s.com";
const STATS_LINK_TEXT =
  "For the forensic details, the full data breakdown is on the tournament stats page.";

const InputSchema = z.object({
  tournamentId: z.string().uuid(),
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

/** Supabase silently caps at 1,000 rows. Page exhaustively. */
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
on psychological warfare. Every sentence lands a sharp insight. Eradicate sports
cliches.

VOICE: British-inflected satire. High-vocabulary prose welded to group-chat wit.
Atomic brevity: short, punchy sentences. Heavy bolding. This is the report on how
a completed major actually played out, so it is a story about vindication and
humiliation, not a preview.

THE THROUGH-LINE: in Major7s the field tends to pile into a small number of
"chalk" golfers, and majors keep punishing them. Where the data shows the
most-picked golfer flopping while the winner backed someone the pool ignored,
that IS the story. Lead with it. Do not soften it.

STRUCTURE for a Final report. Follow it exactly:

1. Opening. Two or three sentences. The real-world winner and result (from the
   data), then the Major7s champion and their winning margin. Weave in the
   colour notes if any real-world drama is supplied. No heading.

2. "## The Podium" - a compact table: finish, team, points. Mark any debutant.

3. "## How they got there" - a short paragraph per podium team. Their counting
   five, where it was won or lost, and their career context from
   "podiumHistory" (events played, previous best, record at this major). A
   debutant finishing on the podium is a story: say so. Use the colour notes
   for any human detail about these players.

4. "## The Difference-Makers" - a table of the three counting fives side by
   side with each team's weak link, then one line on what separated them.

5. "## The Herd Walked Off a Cliff" - the chalk report. The most-picked golfers
   and how they actually finished, as a table. This is where you are cruel.

6. "## The Records" - the winning score against the family record and the
   all-time best, using "records". If the winning score ranks among the best
   ever, say exactly where (this is supplied as winnerRank). Then the wooden
   spoon against the all-time worst.

7. "## BOTR - Best of the Rest" - the consolation competition for teams that
   lost three or more picks to the cut. Name the winner, their surviving
   golfers, and the sting: how many fully-intact teams they still out-scored.

8. Closing line. Use the EXACT markdown link supplied as "statsPageLink" as the
   final line. Do not reword it or rebuild the URL.

NON-NEGOTIABLE TERMINOLOGY:
- Team selections are "picks", never "roster"/"card"/"owned".
- Always "Major7s", never "M7".
- Tied positions are T{Pos}, e.g. T14. Never "=14".
- FULL NAMES ALWAYS, for teams AND golfers. Never shorten a golfer to a surname:
  the field contains multiple Kims (Tom Kim, Si Woo Kim, Michael Kim), two
  Fitzpatricks (Matt, Alex), two Hoejgaards, and several Smiths and Browns.
  A surname alone is ambiguous and will misreport results. Write the full name
  every single time, in prose and in tables.
- Never invent a nickname or a statistic. Use only names and numbers in the data.
- British English. No em dashes: use hyphens. A bare +N or -N reads as over/under
  par, so never use it as a generic count.

FORMATTING:
- Markdown only. NO raw HTML, NO SVG: the renderer strips them silently.
- Column is narrow (672px). Tables 4 columns maximum. Prefer prose elsewhere.
- Do not use images.

DATA: you are given the final pack (scored results, podium cards, chalk
outcomes, wooden spoon, BOTR), a records object, a podiumHistory object, and
free-text colour notes. Use ONLY numbers present in those objects. If a number
is not given, do not state it. The colour notes are the only source of
real-world context: weave them in, never just repeat them.

OUTPUT: Return exactly this format and nothing else. No JSON, no code fences,
no preamble:

TITLE: <the title on one line>
BODY:
<the post in Markdown>`;

function fmtCard(team: FinalPack["podium"][number]) {
  return {
    team: team.team,
    total: team.total,
    debutant: team.debutant,
    countingFive: team.card
      .filter((c) => c.counted)
      .map((c) => ({ golfer: c.name, position: c.positionDisplay, points: c.points })),
    dropped: team.card
      .filter((c) => !c.counted)
      .map((c) => ({ golfer: c.name, position: c.positionDisplay })),
    weakLink: (() => {
      const counted = team.card.filter((c) => c.counted);
      const worst = counted[counted.length - 1];
      return worst ? { golfer: worst.name, position: worst.positionDisplay } : null;
    })(),
    survivorCount: team.survivorCount,
  };
}

/** Shape the pack for the prompt: names resolved, only the storytelling bits. */
function summariseFinal(pack: FinalPack) {
  return {
    status: pack.status,
    teams: pack.podium.length ? pack.fieldSize : 0,
    fieldMedian: pack.fieldMedian,
    winningMargin: pack.winningMargin,

    podium: pack.podium.map(fmtCard),
    debutantsOnPodium: pack.debutantsOnPodium,

    woodenSpoon: pack.woodenSpoon
      ? {
          team: pack.woodenSpoon.team,
          total: pack.woodenSpoon.total,
          survivorCount: pack.woodenSpoon.survivorCount,
          debutant: pack.woodenSpoon.debutant,
        }
      : null,

    chalkReport: pack.chalkOutcomes.map((c) => ({
      golfer: c.name,
      pickedBy: c.pickedBy,
      finished: c.positionDisplay,
      cut: c.cut,
    })),

    bestPicks: pack.bestPicks.map((c) => ({
      golfer: c.name,
      finished: c.positionDisplay,
      pickedBy: c.pickedBy,
    })),

    detonations: pack.worstPicks
      .filter((c) => c.pickedBy >= 10)
      .map((c) => ({ golfer: c.name, finished: c.positionDisplay, pickedBy: c.pickedBy })),

    cut: { total: pack.totalCut, fieldSize: pack.fieldSize },

    botr: pack.botr.winner
      ? {
          winner: pack.botr.winner.team,
          points: pack.botr.winner.total,
          survivorCount: pack.botr.winner.survivorCount,
          survivors: pack.botr.winner.survivors.map((s) => ({
            golfer: s.name,
            position: s.positionDisplay,
          })),
          fieldSize: pack.botr.fieldSize,
          beatFullTeams: pack.botr.beatFullTeams,
          fullTeamCount: pack.botr.fullTeamCount,
        }
      : null,
  };
}

/**
 * Where does the winning score rank among all winning scores ever? Computed
 * here from the records object rather than asked of the model, so the "third
 * lowest ever" style claim is always exact.
 */
function winnerRankLine(
  winnerPoints: number | null,
  records: any,
): { text: string } | null {
  if (winnerPoints == null || !records) return null;
  const best = records.all_time_best?.points ?? null;
  const familyRecord = records.family_record?.points ?? null;
  const parts: string[] = [];
  if (familyRecord != null) {
    if (winnerPoints < familyRecord) {
      parts.push(
        `${winnerPoints} is a new Major7s ${records.family} record, beating the previous best of ${familyRecord}.`,
      );
    } else {
      parts.push(
        `${winnerPoints} does not beat the Major7s ${records.family} record of ${familyRecord}.`,
      );
    }
  }
  if (best != null && winnerPoints > best) {
    parts.push(`The all-time best across every major is ${best}.`);
  } else if (best != null && winnerPoints <= best) {
    parts.push(`${winnerPoints} is the lowest winning score in Major7s history.`);
  }
  return parts.length ? { text: parts.join(" ") } : null;
}

export const generateFinalReport = createServerFn({ method: "POST" })
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
        .select("id, name, location, start_date, status")
        .eq("id", data.tournamentId)
        .maybeSingle();
      if (tErr) return { ok: false, error: tErr.message };
      if (!tournament) return { ok: false, error: "Tournament not found" };

      // ---- fetch everything the pack needs ---------------------------
      let pack: FinalPack;
      let podiumIds: string[] = [];
      let records: any = null;
      let podiumHistory: any = {};
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

        const leaderboard = await fetchAll<LeaderboardRow>((from, to) =>
          supabaseAdmin
            .from("tournament_leaderboard")
            .select(
              "golfer_id, espn_display_name, position_numeric, position_display, status_type, score_to_par, withdrew_after_round, rounds_completed",
            )
            .eq("tournament_id", data.tournamentId)
            .range(from, to)
            .returns<LeaderboardRow[]>(),
        );

        const scores = await fetchAll<ScoreRow>((from, to) =>
          supabaseAdmin
            .from("tournament_scores")
            .select("team_id, total_points, thru_cut, position_numeric, position_display")
            .eq("tournament_id", data.tournamentId)
            .range(from, to),
        );
        if (scores.length === 0) {
          return { ok: false, error: "No scores yet. Import leaderboard data and score first." };
        }

        const teamIds = Array.from(new Set(picks.map((p) => p.team_id)));
        const teams: Team[] = [];
        for (let i = 0; i < teamIds.length; i += 200) {
          const { data: chunk, error } = await supabaseAdmin
            .from("teams")
            .select("id, nickname")
            .in("id", teamIds.slice(i, i + 200));
          if (error) return { ok: false, error: error.message };
          teams.push(...((chunk ?? []) as Team[]));
        }

        // Debutants come from the picks-closed context RPC (already deployed):
        // teams with no picks in any earlier-start tournament.
        const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc(
          "major7s_report_context",
          { p_tournament_id: data.tournamentId },
        );
        if (ctxErr) return { ok: false, error: `Context failed: ${ctxErr.message}` };
        const debutantIds = new Set<string>(
          Array.isArray(ctx?.debutants) ? ctx.debutants.map((d: any) => d.team_id) : [],
        );

        // rounds_completed: max across the field (all finishers share it).
        const roundsCompleted = leaderboard.reduce(
          (max, r: any) => Math.max(max, Number(r.rounds_completed ?? 0)),
          0,
        );

        pack = buildFinalPack(
          picks,
          golfers,
          teams,
          leaderboard,
          scores,
          roundsCompleted,
          debutantIds,
        );
        podiumIds = pack.podium.map((t) => t.teamId);

        // ---- records + career history --------------------------------
        records = ctx; // reuse: records live in the same context payload
        if (podiumIds.length) {
          const { data: hist, error: hErr } = await (supabaseAdmin as any).rpc(
            "major7s_final_context",
            { p_tournament_id: data.tournamentId, p_team_ids: podiumIds },
          );
          if (hErr) return { ok: false, error: `History failed: ${hErr.message}` };
          podiumHistory = hist ?? {};
        }
      } catch (e: any) {
        return { ok: false, error: `Build failed: ${e?.message ?? String(e)}` };
      }

      // ---- prompt ----------------------------------------------------
      const statsUrl = `${PUBLIC_SITE_ORIGIN}/tournament/${data.tournamentId}/stats`;
      const statsPageLink = `*[${STATS_LINK_TEXT}](${statsUrl})*`;

      // podiumHistory is keyed by team id; re-key by nickname so the model can
      // match it to the podium without seeing a uuid.
      const historyByName: Record<string, any> = {};
      for (const h of Object.values(podiumHistory as Record<string, any>)) {
        if (h?.team) historyByName[h.team] = h;
      }

      const payload = {
        tournament: {
          name: tournament.name,
          location: tournament.location,
          startDate: tournament.start_date,
        },
        winner: pack.winner
          ? { team: pack.winner.team, points: pack.winner.total }
          : null,
        winnerRank: winnerRankLine(pack.winner?.total ?? null, records),
        pack: summariseFinal(pack),
        records,
        podiumHistory: historyByName,
        colourNotes: data.colourNotes || "(none supplied)",
        statsPageLink,
      };

      // ---- generate --------------------------------------------------
      let title = "";
      let body = "";
      try {
        const res = await fetch(AI_GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Write the final report.\n\n${JSON.stringify(payload, null, 2)}`,
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

        const cleaned = raw.replace(/^```(?:\w+)?\s*/i, "").replace(/```\s*$/, "").trim();
        const titleMatch = cleaned.match(/^\s*TITLE:\s*(.+?)\s*$/m);
        const bodyIndex = cleaned.search(/^\s*BODY:\s*$/m);
        if (titleMatch && bodyIndex !== -1) {
          title = titleMatch[1].trim();
          body = cleaned.slice(bodyIndex).replace(/^\s*BODY:\s*$/m, "").trim();
        } else {
          const lines = cleaned.split("\n");
          const firstIdx = lines.findIndex((l) => l.trim());
          title = (lines[firstIdx] ?? "").replace(/^#+\s*/, "").replace(/^TITLE:\s*/i, "").trim();
          body = lines.slice(firstIdx + 1).join("\n").replace(/^\s*BODY:\s*$/m, "").trim();
        }
        if (!title || !body) return { ok: false, error: "AI returned no title or body" };

        // Guarantee the closing link. Strip any variant the model wrote.
        body = body
          .split("\n")
          .filter((line) => {
            const l = line.toLowerCase();
            if (l.includes("/tournament/") && l.includes("/stats")) return false;
            if (l.includes("stats page") && line.trim().startsWith("*")) return false;
            return true;
          })
          .join("\n")
          .trim();
        body = `${body}\n\n${statsPageLink}`;
      } catch (e: any) {
        return { ok: false, error: `Generation failed: ${e?.message ?? String(e)}` };
      }

      await supabaseAdmin.from("admin_audit").insert({
        actor_id: context.userId,
        action: "blog.final_report_generated",
        detail: {
          tournament_id: data.tournamentId,
          tournament: tournament.name,
          winner: pack.winner?.team ?? null,
          winning_score: pack.winner?.total ?? null,
          model: AI_MODEL,
          had_colour_notes: Boolean(data.colourNotes),
        },
      });

      // Deliberately does NOT publish. Publishing stays an explicit second click.
      return { ok: true, title, body };
    },
  );
