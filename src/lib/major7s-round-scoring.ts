// Shared Major7s round-scoring logic — single source of truth for both the
// public leaderboard (tournament.$id.leaderboard.tsx) and the admin end of
// round export panel. Extracted verbatim from tournament.$id.leaderboard.tsx
// (computeRoundScores, buildRoundPositionMap, getInProgressRound, etc.) so
// the two callers can never score the same round differently. If the rules
// change, they change here once — do not fork this file.
//
// TODO (recommended follow-up, not done automatically): update
// tournament.$id.leaderboard.tsx to import these from here instead of
// defining its own local copies, so there's truly one implementation.

export type Round = "r1" | "r2" | "r3" | "r4";

export const NON_FINISHER_POINTS = 100;

// Only the tournament_leaderboard columns the functions below actually
// read. Callers may select a superset (e.g. country, total_strokes) —
// structural typing means extra fields are fine.
export interface ScoringLbRow {
  golfer_id: string | null;
  espn_display_name: string;
  status_type: string | null;
  status_short_detail: string | null;
  round_1: number | null;
  round_2: number | null;
  round_3: number | null;
  round_4: number | null;
  position_r1: number | null;
  position_r2: number | null;
  position_r3: number | null;
  position_r4: number | null;
}

export interface RoundTeamScore {
  team_id: string;
  nickname: string;
  owner_user_id: string;
  total: number;
  position: number;
  is_tie: boolean;
  picks: RoundPickScore[];
  thru_cut: number | null; // null on R1/R2 (meaningless pre-cut)
  delta: number | null; // movement from previous round (positive = climbed)
}

export interface RoundPickScore {
  golfer_id: string;
  golfer_name: string;
  bucket: number;
  round_positions: (number | null)[];
  is_latest_carryforward: boolean;
  points: number;
  counted: boolean;
  status_label: string | null; // "(CUT)" or "(WD)"
}

export function isCutOrWithdrawn(status: string | null) {
  return status === "STATUS_CUT" || status === "STATUS_WITHDRAWN";
}

/** WD specifically — ESPN maps both CUT and WD under STATUS_CUT, distinguished by shortDetail. */
export function isWithdrawn(row: { status_type: string | null; status_short_detail: string | null }): boolean {
  if (row.status_type === "STATUS_WITHDRAWN") return true;
  if (isCutOrWithdrawn(row.status_type) && row.status_short_detail?.toUpperCase().includes("WD")) return true;
  return false;
}

/** Return the ESPN-stored position for a specific round. */
export function espnPositionForRound(row: ScoringLbRow, round: Round): number | null {
  switch (round) {
    case "r1": return row.position_r1;
    case "r2": return row.position_r2;
    case "r3": return row.position_r3;
    case "r4": return row.position_r4;
  }
}

/**
 * Detect which round (if any) is currently in progress.
 * A round is in-progress when at least one golfer has STATUS_IN_PROGRESS
 * and that round is the latest one they have stroke data for.
 */
export function getInProgressRound(lbRows: ScoringLbRow[]): Round | null {
  const ipRows = lbRows.filter((r) => r.status_type === "STATUS_IN_PROGRESS");
  if (ipRows.length === 0) return null;
  if (ipRows.some((r) => r.round_4 != null)) return "r4";
  if (ipRows.some((r) => r.round_3 != null)) return "r3";
  if (ipRows.some((r) => r.round_2 != null)) return "r2";
  if (ipRows.some((r) => r.round_1 != null)) return "r1";
  return null;
}

/**
 * Build correct golfer positions for a round.
 *
 * For COMPLETED rounds: recompute from cumulative stroke totals using
 * Standard Competition Ranking. ESPN's linescores.currentPosition is a
 * snapshot taken when each golfer finishes and is not recalculated after
 * all golfers complete, so we recompute for accuracy.
 *
 * For IN-PROGRESS rounds: use ESPN's live position_rX directly. In-progress
 * golfers have partial stroke totals (e.g. 66 through 17 holes) that pass
 * the MIN_COMPLETE filter and corrupt cumulative-based rankings.
 */
export function buildRoundPositionMap(
  lbRows: ScoringLbRow[],
  round: Round,
  inProgressRound: Round | null,
): Map<string, number> {
  if (round === inProgressRound) {
    const posMap = new Map<string, number>();
    for (const row of lbRows) {
      if (!row.golfer_id) continue;
      const pos = espnPositionForRound(row, round);
      if (pos != null) posMap.set(row.golfer_id, pos);
    }
    return posMap;
  }

  const MIN_COMPLETE = 58; // no completed major round has ever been below 61
  const entries: { golfer_id: string; cumulative: number }[] = [];

  for (const row of lbRows) {
    if (!row.golfer_id) continue;
    const r1 = row.round_1;
    const r2 = row.round_2;
    const r3 = row.round_3;
    const r4 = row.round_4;

    let cum: number | null = null;
    if (round === "r1" && r1 != null && r1 >= MIN_COMPLETE) {
      cum = r1;
    } else if (round === "r2" && r1 != null && r2 != null && r1 >= MIN_COMPLETE && r2 >= MIN_COMPLETE) {
      cum = r1 + r2;
    } else if (
      round === "r3" && r1 != null && r2 != null && r3 != null &&
      r1 >= MIN_COMPLETE && r2 >= MIN_COMPLETE && r3 >= MIN_COMPLETE
    ) {
      cum = r1 + r2 + r3;
    } else if (
      round === "r4" && r1 != null && r2 != null && r3 != null && r4 != null &&
      r1 >= MIN_COMPLETE && r2 >= MIN_COMPLETE && r3 >= MIN_COMPLETE && r4 >= MIN_COMPLETE
    ) {
      cum = r1 + r2 + r3 + r4;
    }
    if (cum != null) entries.push({ golfer_id: row.golfer_id, cumulative: cum });
  }

  entries.sort((a, b) => a.cumulative - b.cumulative);

  const posMap = new Map<string, number>();
  let rank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].cumulative !== entries[i - 1].cumulative) rank = i + 1;
    posMap.set(entries[i].golfer_id, rank);
  }
  return posMap;
}

/**
 * Compute Major7s team scores on the fly for any round (R1–R4).
 * Positions are recomputed from round scores (not ESPN snapshots).
 * Best 5 of 7 count. Standard Competition Ranking for ties.
 */
export function computeRoundScores(
  teams: { id: string; nickname: string; owner_user_id: string }[],
  picks: { team_id: string; bucket: number; golfer_id: string }[],
  lbRows: ScoringLbRow[],
  round: Round,
): RoundTeamScore[] {
  const roundIndex = round === "r1" ? 0 : round === "r2" ? 1 : round === "r3" ? 2 : 3;
  const allRounds: Round[] = (["r1", "r2", "r3", "r4"] as Round[]).slice(0, roundIndex + 1);
  const inProgressRound = getInProgressRound(lbRows);
  const posMaps = allRounds.map((r) => buildRoundPositionMap(lbRows, r, inProgressRound));

  const lbByGolfer = new Map<string, ScoringLbRow>();
  for (const row of lbRows) {
    if (row.golfer_id) lbByGolfer.set(row.golfer_id, row);
  }

  const scored: RoundTeamScore[] = teams.map((team) => {
    const teamPicks = picks.filter((p) => p.team_id === team.id);
    const pickScores: RoundPickScore[] = teamPicks.map((pick) => {
      const lb = lbByGolfer.get(pick.golfer_id);

      // --- WD: always 100, every round ---
      if (lb && isWithdrawn(lb)) {
        return {
          golfer_id: pick.golfer_id,
          golfer_name: lb.espn_display_name || "Unknown",
          bucket: pick.bucket,
          round_positions: allRounds.map(() => null),
          is_latest_carryforward: false,
          points: NON_FINISHER_POINTS,
          counted: false,
          status_label: "(WD)",
        };
      }

      // --- CUT: actual position in R1, 100 from R2 onwards ---
      if (lb && isCutOrWithdrawn(lb.status_type) && round !== "r1") {
        const r1Pos = posMaps[0].get(pick.golfer_id) ?? null;
        return {
          golfer_id: pick.golfer_id,
          golfer_name: lb.espn_display_name || "Unknown",
          bucket: pick.bucket,
          round_positions: allRounds.map((_r, i) => (i === 0 ? r1Pos : null)),
          is_latest_carryforward: false,
          points: NON_FINISHER_POINTS,
          counted: false,
          status_label: "(CUT)",
        };
      }

      // --- Normal scoring ---
      const positions = allRounds.map((_r, i) => posMaps[i].get(pick.golfer_id) ?? null);
      const posVal = positions[positions.length - 1];

      // Mid-round fallback: carry forward previous round's position
      let effectivePos: number | null = posVal;
      let isCarryforward = false;
      if (effectivePos === null && round !== "r1" && lb && !isCutOrWithdrawn(lb.status_type)) {
        const prevPos = positions.length > 1 ? positions[positions.length - 2] : null;
        effectivePos = prevPos;
        isCarryforward = effectivePos !== null;
        positions[positions.length - 1] = effectivePos;
      }

      return {
        golfer_id: pick.golfer_id,
        golfer_name: lb?.espn_display_name || "Unknown",
        bucket: pick.bucket,
        round_positions: positions,
        is_latest_carryforward: isCarryforward,
        points: effectivePos ?? NON_FINISHER_POINTS,
        counted: false,
        status_label: null,
      };
    });

    // Mark best 5 as counted
    const sorted = [...pickScores].sort((a, b) => a.points - b.points);
    const countedIds = new Set<string>();
    for (let i = 0; i < Math.min(5, sorted.length); i++) {
      countedIds.add(sorted[i].golfer_id);
    }
    for (const ps of pickScores) {
      ps.counted = countedIds.has(ps.golfer_id);
    }

    const total = sorted
      .slice(0, Math.min(5, sorted.length))
      .reduce((sum, p) => sum + p.points, 0);

    // thru_cut meaningful on R3 and R4 (post-cut rounds)
    let thruCut: number | null = null;
    if (round === "r3" || round === "r4") {
      thruCut = pickScores.filter((p) => {
        const lastPos = p.round_positions[p.round_positions.length - 1];
        return lastPos !== null;
      }).length;
    }

    return {
      team_id: team.id,
      nickname: team.nickname,
      owner_user_id: team.owner_user_id,
      total,
      position: 0,
      is_tie: false,
      picks: pickScores,
      thru_cut: thruCut,
      delta: null,
    };
  });

  scored.sort((a, b) => a.total - b.total);

  // Standard Competition Ranking
  let rank = 1;
  for (let i = 0; i < scored.length; i++) {
    if (i > 0 && scored[i].total === scored[i - 1].total) {
      scored[i].position = scored[i - 1].position;
      scored[i].is_tie = true;
      scored[i - 1].is_tie = true;
    } else {
      scored[i].position = rank;
    }
    rank++;
  }

  return scored;
}
