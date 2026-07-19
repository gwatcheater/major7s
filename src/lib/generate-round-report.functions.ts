import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildRoundPack } from "@/lib/stats/buildRoundPack";
import type { Golfer, Pick, Team } from "@/lib/stats/types";
import type { RoundKey, RoundLbRow, RoundPack } from "@/lib/stats/round-types";

// Same gateway/site constants as the other generators. Centralise if you wish.
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const PUBLIC_SITE_ORIGIN = "https://www.major7s.com";
const STATS_LINK_TEXT =
  "For the forensic details, the full data breakdown is on the tournament stats page.";

const InputSchema = z.object({
  tournamentId: z.string().uuid(),
  round: z.enum(["r1", "r2", "r3"]),
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

const BASE_VOICE = `ROLE: Master of ceremonies for the Major7s fantasy golf pool. Hyper-literate,
aggressively cynical, data-obsessed. Audience: close golf-nerd friends who thrive
on psychological warfare. Every sentence lands a sharp insight. Eradicate sports
cliches.

VOICE: British-inflected satire. High-vocabulary prose welded to group-chat wit.
Atomic brevity: short, punchy sentences. Heavy bolding.

LENGTH: THIS IS A MID-TOURNAMENT ROUND REPORT. It is SHORT and it MOVES. Three or
four tight sections, no more. Readers are checking on their phone between holes.
Do not pad. Do not recap the rules. Get in, land the movement, get out.

NON-NEGOTIABLE TERMINOLOGY:
- Team selections are "picks", never "roster"/"card"/"owned".
- Always "Major7s", never "M7".
- Tied positions are T{Pos}, e.g. T4. Never "=4".
- FULL NAMES ALWAYS, teams AND golfers. Never a bare surname: the field has
  multiple Kims, Fitzpatricks, Smiths, Browns and two Hoejgaards, so a surname
  alone misreports who did what. Full name every time, prose and tables.
- Never invent a nickname or a statistic. Only names and numbers in the data.
- British English. No em dashes: use hyphens. A bare +N or -N reads as over or
  under par in golf, so never use it as a generic count; write "climbed 12
  places", not "+12 places".

MOVEMENT: positions use Standard Competition Ranking. A positive delta is a CLIMB
(the team improved to a lower position number). Describe climbs and falls in
plain English: "surged from 82nd to 8th", not "+74".

FORMATTING:
- Markdown only. NO raw HTML, NO SVG: the renderer strips them silently.
- Column is narrow (672px). Tables 4 columns maximum. Prefer prose.
- No images.

DATA: you are given a round pack (standings, movers, chalk watch, cut data if
relevant) and free-text colour notes. Use ONLY numbers present in the data. The
colour notes are the only real-world context: weave them in, never just repeat.

OUTPUT: Return exactly this format and nothing else. No JSON, no code fences,
no preamble:

TITLE: <the title on one line>
BODY:
<the post in Markdown>`;

const ROUND_STRUCTURE: Record<RoundKey, string> = {
  r1: `THIS IS THE ROUND ONE REPORT. The board has just taken shape. Structure:
1. Opening: who leads the Major7s standings after 18 holes, and the real-golf
   leader. Two sentences. No heading.
2. "## The Early Pace" - the top of the Major7s leaderboard (a short table:
   position, team, points). Note where the real tournament leader was picked by
   almost nobody, if true - the pool rarely backs the fast starter.
3. "## The Chalk Watch" - how the most-picked golfers have started. If the pool's
   favourite is already struggling, this is the story.
4. One-line sign-off: it is Thursday, everything can still change, and the R1
   leader usually is not the one holding the trophy.`,

  r2: `THIS IS THE ROUND TWO REPORT, AND ROUND TWO IS CUT DAY. The cut is the story.
Structure:
1. Opening: who leads after 36 holes, and the headline cut casualty (a popular
   golfer who missed it). Two sentences. No heading.
2. "## The Cut" - how many golfers missed it, the most-picked names among them
   (a short table: golfer, picked by), and the teams hit hardest (how many of
   their picks were cut). This is where you are cruel.
3. "## Moving On Up" - the biggest climbers into the weekend (a short table:
   team, from, to). Describe the leap in words.
4. "## The Standings" - the current Major7s top of the board.
5. One-line sign-off pointing to the weekend.`,

  r3: `THIS IS THE ROUND THREE REPORT. ROUND THREE IS MOVING DAY: the weekend
leaderboard has taken its final shape before Sunday. Structure:
1. Opening: who leads the Major7s standings going into the final round, and by
   how much. Two sentences. No heading.
2. "## Moving Day" - the biggest climbers and fallers (short tables). This is the
   heart of the report: who has surged into contention, who has thrown it away.
   Describe the moves in words, not just numbers.
3. "## The Final-Round Podium Chase" - the current Major7s top 5, and the gap the
   leader holds. Note if the leader is a debutant or an unlikely name.
4. One-line sign-off: it is set up for Sunday, and moving day usually decides it.`,
};

function summariseRound(pack: RoundPack) {
  return {
    round: pack.round,
    roundNumber: pack.roundNumber,
    entries: pack.entryCount,
    fieldMedian: pack.fieldMedian,
    leader: pack.leader
      ? { team: pack.leader.team, points: pack.leader.total, position: pack.leader.positionDisplay }
      : null,
    standings: pack.top.map((t) => ({
      position: t.positionDisplay,
      team: t.team,
      points: t.total,
      movement:
        t.delta == null ? null : t.delta > 0 ? `climbed ${t.delta}` : t.delta < 0 ? `fell ${-t.delta}` : "held",
    })),
    climbers: pack.climbers.map((m) => ({ team: m.team, from: m.from, to: m.to, places: m.delta })),
    fallers: pack.fallers.map((m) => ({ team: m.team, from: m.from, to: m.to, places: -m.delta })),
    golfLeaders: pack.golfLeaders.map((g) => ({
      golfer: g.name,
      position: g.positionDisplay,
      pickedBy: g.pickedBy,
    })),
    chalkWatch: pack.chalkWatch.map((c) => ({
      golfer: c.name,
      position: c.positionDisplay,
      pickedBy: c.pickedBy,
    })),
    cut: pack.cut.isCutRound
      ? {
          missed: pack.cut.totalCut,
          fieldSize: pack.cut.fieldSize,
          notableCut: pack.cut.notableCut.map((c) => ({ golfer: c.name, pickedBy: c.pickedBy })),
          hardestHit: pack.cut.hardestHit,
        }
      : null,
  };
}

export const generateRoundReport = createServerFn({ method: "POST" })
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

      const { data: tournament, error: tErr } = await supabaseAdmin
        .from("tournaments")
        .select("id, name, location, start_date")
        .eq("id", data.tournamentId)
        .maybeSingle();
      if (tErr) return { ok: false, error: tErr.message };
      if (!tournament) return { ok: false, error: "Tournament not found" };

      const roundNumber = data.round === "r1" ? 1 : data.round === "r2" ? 2 : 3;

      let pack: RoundPack;
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

        const leaderboard = await fetchAll<RoundLbRow>((from, to) =>
          supabaseAdmin
            .from("tournament_leaderboard")
            .select(
              "golfer_id, espn_display_name, status_type, status_short_detail, round_1, round_2, round_3, round_4",
            )
            .eq("tournament_id", data.tournamentId)
            .range(from, to),
        );

        // Verify the round is actually complete before reporting on it. A round
        // reports on cumulative strokes, so we require most of the field to have
        // a score for this round's final column.
        const col = (`round_${roundNumber}` as "round_1" | "round_2" | "round_3");
        const withScore = leaderboard.filter((r) => (r as any)[col] != null).length;
        if (withScore < 20) {
          return {
            ok: false,
            error: `Round ${roundNumber} does not look complete yet (only ${withScore} scores). Import the leaderboard after the round finishes.`,
          };
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

        pack = buildRoundPack(data.round as RoundKey, picks, golfers, teams, leaderboard);
      } catch (e: any) {
        return { ok: false, error: `Build failed: ${e?.message ?? String(e)}` };
      }

      const statsUrl = `${PUBLIC_SITE_ORIGIN}/tournament/${data.tournamentId}/stats`;
      const statsPageLink = `*[${STATS_LINK_TEXT}](${statsUrl})*`;

      const payload = {
        tournament: {
          name: tournament.name,
          location: tournament.location,
          startDate: tournament.start_date,
        },
        round: summariseRound(pack),
        colourNotes: data.colourNotes || "(none supplied)",
        statsPageLink,
      };

      const systemPrompt = `${BASE_VOICE}\n\n${ROUND_STRUCTURE[data.round as RoundKey]}\n\nAlways end with the exact statsPageLink from the data as the final line.`;

      let title = "";
      let body = "";
      try {
        const res = await fetch(AI_GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `Write the round ${roundNumber} report.\n\n${JSON.stringify(payload, null, 2)}`,
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
        action: "blog.round_report_generated",
        detail: {
          tournament_id: data.tournamentId,
          tournament: tournament.name,
          round: data.round,
          leader: pack.leader?.team ?? null,
          model: AI_MODEL,
          had_colour_notes: Boolean(data.colourNotes),
        },
      });

      return { ok: true, title, body };
    },
  );
