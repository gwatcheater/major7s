import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  tournament_id: z.string().uuid(),
  espn_event_id: z.string().min(1).max(64),
});

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePositionNumeric(displayName: string | undefined | null): number | null {
  if (!displayName) return null;
  const stripped = displayName.replace(/^T/i, "").trim();
  const n = parseInt(stripped, 10);
  return Number.isFinite(n) ? n : null;
}

// Major7s scoring: each pick scores its golfer's finishing position; non-finishers (CUT/WD/DQ/etc) score 100.
// Team total = best (lowest) 5 of 7 pick scores. Team position = standard golf-style ranking with ties.
const NON_FINISHER_POINTS = 100;
function isFinishedStatus(status: string | null): boolean {
  // STATUS_FINISH is the "finished" status from ESPN; everything else (STATUS_CUT, STATUS_WITHDRAWN, etc.) counts as non-finished.
  return status === "STATUS_FINISH";
}

interface LbForScoring {
  golfer_id: string | null;
  position_numeric: number | null;
  status_type: string | null;
}

interface PickRow {
  team_id: string;
  bucket: number;
  golfer_id: string | null;
}

interface PickScore {
  bucket: number;
  golfer_id: string | null;
  golfer_name: string;
  points: number;
  status_type: string | null;
  counted: boolean;
}

interface TeamAggregate {
  team_id: string;
  total_points: number;
  thru_cut: number;
  picks: PickScore[];
}

async function calculateMajor7sScores(
  tournamentId: string,
  calculatedByUserId: string,
): Promise<{ teams_scored: number; teams_skipped_incomplete: number }> {
  // 1) Pull the leaderboard we just upserted, keyed by golfer_id.
  const { data: lbRows, error: lbErr } = await supabaseAdmin
    .from("tournament_leaderboard")
    .select("golfer_id, position_numeric, status_type")
    .eq("tournament_id", tournamentId);
  if (lbErr) throw new Error(`Score calc: ${lbErr.message}`);

  const lbByGolferId = new Map<string, LbForScoring>();
  for (const row of (lbRows ?? []) as LbForScoring[]) {
    if (row.golfer_id) lbByGolferId.set(row.golfer_id, row);
  }

  // 2) Pull all picks for this tournament, plus their golfer names (snapshot).
  // Paginated to avoid Supabase PostgREST 1000-row default limit.
  const pickRows: PickRow[] = [];
  {
    const PAGE_SIZE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from("picks")
        .select("team_id, bucket, golfer_id")
        .eq("tournament_id", tournamentId)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Score calc: ${error.message}`);
      const rows = (data ?? []) as PickRow[];
      pickRows.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  const allGolferIds = Array.from(
    new Set(pickRows.map((p) => p.golfer_id).filter((x): x is string => !!x)),
  );
  const golferNameById = new Map<string, string>();
  if (allGolferIds.length > 0) {
    const { data: golferRows, error: gErr } = await supabaseAdmin
      .from("golfers")
      .select("id, golfer_name")
      .in("id", allGolferIds);
    if (gErr) throw new Error(`Score calc: ${gErr.message}`);
    for (const g of golferRows ?? []) {
      golferNameById.set(g.id, g.golfer_name);
    }
  }

  // 3) Group picks by team.
  const picksByTeam = new Map<string, PickRow[]>();
  for (const p of pickRows) {
    const arr = picksByTeam.get(p.team_id) ?? [];
    arr.push(p);
    picksByTeam.set(p.team_id, arr);
  }

  // 4) Score each team — only teams with all 7 picks.
  const aggregates: TeamAggregate[] = [];
  let skipped = 0;
  for (const [teamId, picks] of picksByTeam) {
    if (picks.length !== 7) {
      skipped++;
      continue;
    }
    const scored: PickScore[] = picks.map((p) => {
      const lb = p.golfer_id ? lbByGolferId.get(p.golfer_id) : undefined;
      const status = lb?.status_type ?? null;
      let points: number;
      if (!lb) {
        // Picked golfer not on the leaderboard at all — treat as non-finisher.
        points = NON_FINISHER_POINTS;
      } else if (!isFinishedStatus(status)) {
        points = NON_FINISHER_POINTS;
      } else {
        points = lb.position_numeric ?? NON_FINISHER_POINTS;
      }
      return {
        bucket: p.bucket,
        golfer_id: p.golfer_id,
        golfer_name: (p.golfer_id && golferNameById.get(p.golfer_id)) || "Unknown",
        points,
        status_type: status,
        counted: false,
      };
    });

    // Best (lowest) 5 of 7 count toward total.
    // Sort by points ascending; tie-break by bucket ascending so that on tied
    // scores we keep the lower bucket in the best-5 and mute the higher bucket
    // (Major7s convention).
    const sortedByPoints = [...scored].sort((a, b) => a.points - b.points || a.bucket - b.bucket);
    const countedSet = new Set<number>();
    for (let i = 0; i < 5 && i < sortedByPoints.length; i++) {
      countedSet.add(sortedByPoints[i].bucket);
    }
    for (const s of scored) {
      if (countedSet.has(s.bucket)) s.counted = true;
    }
    const total = scored.filter((s) => s.counted).reduce((sum, s) => sum + s.points, 0);
    const thruCut = scored.filter((s) => isFinishedStatus(s.status_type)).length;

    // Re-order picks back to bucket order for storage.
    scored.sort((a, b) => a.bucket - b.bucket);

    aggregates.push({
      team_id: teamId,
      total_points: total,
      thru_cut: thruCut,
      picks: scored,
    });
  }

  // 5) Assign positions with golf-style ties (teams on the same total share a position;
  //    the next team takes the position they'd otherwise have had).
  aggregates.sort((a, b) => a.total_points - b.total_points);
  let prevTotal: number | null = null;
  let prevNumeric = 0;
  const ranked = aggregates.map((agg, i) => {
    let numeric: number;
    if (prevTotal !== null && agg.total_points === prevTotal) {
      numeric = prevNumeric; // tied with the previous team — same numeric position
    } else {
      numeric = i + 1;
      prevTotal = agg.total_points;
      prevNumeric = numeric;
    }
    return { ...agg, position_numeric: numeric };
  });

  // Compute T-prefixed display: anyone whose numeric is shared with another team gets "T".
  const countByNumeric = new Map<number, number>();
  for (const r of ranked) countByNumeric.set(r.position_numeric, (countByNumeric.get(r.position_numeric) ?? 0) + 1);
  const positioned = ranked.map((r) => ({
    ...r,
    position_display: (countByNumeric.get(r.position_numeric) ?? 0) > 1 ? `T${r.position_numeric}` : String(r.position_numeric),
  }));

  // 6) Wipe prior scores for this tournament and re-insert (cleanest way to handle
  //    teams that may have dropped out of scoring on recalc).
  const { error: delErr } = await supabaseAdmin
    .from("tournament_scores")
    .delete()
    .eq("tournament_id", tournamentId);
  if (delErr) throw new Error(`Score calc: ${delErr.message}`);

  if (positioned.length === 0) {
    return { teams_scored: 0, teams_skipped_incomplete: skipped };
  }

  // 7) Insert parents, then children.
  const parentRows = positioned.map((p) => ({
    tournament_id: tournamentId,
    team_id: p.team_id,
    total_points: p.total_points,
    thru_cut: p.thru_cut,
    position_display: p.position_display,
    position_numeric: p.position_numeric,
    calculated_at: new Date().toISOString(),
    calculated_by: calculatedByUserId,
  }));
  const { data: insertedParents, error: parentErr } = await supabaseAdmin
    .from("tournament_scores")
    .insert(parentRows)
    .select("id, team_id");
  if (parentErr) throw new Error(`Score calc: ${parentErr.message}`);

  const parentIdByTeam = new Map<string, string>();
  for (const row of insertedParents ?? []) parentIdByTeam.set(row.team_id, row.id);

  const childRows: any[] = [];
  for (const p of positioned) {
    const parentId = parentIdByTeam.get(p.team_id);
    if (!parentId) continue;
    for (const pk of p.picks) {
      childRows.push({
        tournament_score_id: parentId,
        bucket: pk.bucket,
        golfer_id: pk.golfer_id,
        golfer_name: pk.golfer_name,
        points: pk.points,
        status_type: pk.status_type,
        counted: pk.counted,
      });
    }
  }
  if (childRows.length > 0) {
    const { error: childErr } = await supabaseAdmin
      .from("tournament_score_picks")
      .insert(childRows);
    if (childErr) throw new Error(`Score calc (picks): ${childErr.message}`);
  }

  return { teams_scored: positioned.length, teams_skipped_incomplete: skipped };
}

export const importEspnLeaderboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Admin check using service-role client
    const { data: roleRow, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden: admin only");

    // Fetch from ESPN
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${encodeURIComponent(data.espn_event_id)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { error: `ESPN API responded ${res.status}`, imported: 0, matched: 0, unmatched: 0, unmatched_names: [] as string[], teams_scored: 0, teams_skipped_incomplete: 0 };
    }
    const payload: any = await res.json();
    const event = payload?.events?.[0];
    const comp = event?.competitions?.[0];
    if (!comp) {
      return { error: "Unexpected ESPN response (no competition)", imported: 0, matched: 0, unmatched: 0, unmatched_names: [] as string[], teams_scored: 0, teams_skipped_incomplete: 0 };
    }
    const completed = event?.status?.type?.completed === true;
    if (!completed) {
      return { error: "Tournament is not yet final on ESPN", imported: 0, matched: 0, unmatched: 0, unmatched_names: [] as string[], teams_scored: 0, teams_skipped_incomplete: 0 };
    }

    // Local golfers for name match
    const { data: golfers, error: gErr } = await supabaseAdmin
      .from("golfers")
      .select("id, golfer_name")
      .eq("tournament_id", data.tournament_id);
    if (gErr) throw new Error(gErr.message);
    const golferByName = new Map<string, string>();
    for (const g of golfers ?? []) {
      golferByName.set(normalizeName(g.golfer_name), g.id);
    }

    const competitors: any[] = comp?.competitors ?? [];
    const rows: any[] = [];
    const unmatchedNames: string[] = [];
    let matched = 0;

    for (const c of competitors) {
      const espnPlayerId = String(c?.id ?? "");
      const displayName: string = c?.athlete?.displayName ?? "";
      if (!espnPlayerId || !displayName) continue;

      const country: string | null =
        c?.athlete?.flag?.alt ?? c?.athlete?.birthPlace?.countryAbbreviation ?? null;

      const positionDisplay: string | null = c?.status?.position?.displayName ?? null;
      const isTie: boolean = c?.status?.position?.isTie === true;
      const statusType: string | null = c?.status?.type?.name ?? null;
      const positionNumeric =
        statusType === "STATUS_CUT" || statusType === "STATUS_WITHDRAWN" || positionDisplay === "-"
          ? null
          : parsePositionNumeric(positionDisplay);

      const totalStrokes: number | null =
        typeof c?.score?.value === "number" ? c.score.value : null;

      let scoreToPar: number | null = null;
      const stats: any[] = c?.statistics ?? [];
      for (const s of stats) {
        if (s?.name === "scoreToPar" && typeof s?.value === "number") {
          scoreToPar = s.value;
          break;
        }
      }

      const rounds: Record<number, number | null> = { 1: null, 2: null, 3: null, 4: null };
      const linescores: any[] = c?.linescores ?? [];
      for (const ls of linescores) {
        const period = ls?.period;
        if (period >= 1 && period <= 4 && typeof ls?.value === "number") {
          rounds[period] = ls.value;
        }
      }

      const golferId = golferByName.get(normalizeName(displayName)) ?? null;
      if (golferId) matched++;
      else unmatchedNames.push(displayName);

      rows.push({
        tournament_id: data.tournament_id,
        golfer_id: golferId,
        espn_player_id: espnPlayerId,
        espn_display_name: displayName,
        country,
        position_display: positionDisplay,
        position_numeric: positionNumeric,
        is_tie: isTie,
        status_type: statusType,
        total_strokes: totalStrokes,
        score_to_par: scoreToPar,
        round_1: rounds[1],
        round_2: rounds[2],
        round_3: rounds[3],
        round_4: rounds[4],
        imported_at: new Date().toISOString(),
      });
    }

    if (rows.length === 0) {
      return { error: "No competitors found", imported: 0, matched: 0, unmatched: 0, unmatched_names: [], teams_scored: 0, teams_skipped_incomplete: 0 };
    }

    const { error: upErr } = await supabaseAdmin
      .from("tournament_leaderboard")
      .upsert(rows, { onConflict: "tournament_id,espn_player_id" });
    if (upErr) throw new Error(upErr.message);

    // After a successful leaderboard import, calculate Major7s scores.
    const scoringResult = await calculateMajor7sScores(data.tournament_id, userId);

    return {
      imported: rows.length,
      matched,
      unmatched: unmatchedNames.length,
      unmatched_names: unmatchedNames,
      teams_scored: scoringResult.teams_scored,
      teams_skipped_incomplete: scoringResult.teams_skipped_incomplete,
      error: null as string | null,
    };
  });
