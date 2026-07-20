import type { Golfer, Pick, Team } from "./types";
import type {
  Mover,
  RoundGolfer,
  RoundKey,
  RoundLbRow,
  RoundPack,
  RoundTeam,
} from "./round-types";

const CUT_POINTS = 100;
// No completed major round has been below 61; guards against partial/blank rows.
const MIN_COMPLETE = 58;

const ROUND_COLS: Record<RoundKey, Array<keyof RoundLbRow>> = {
  r1: ["round_1"],
  r2: ["round_1", "round_2"],
  r3: ["round_1", "round_2", "round_3"],
};

function isCut(row: RoundLbRow): boolean {
  return row.status_type === "STATUS_CUT" || row.status_type === "STATUS_WD";
}

/**
 * Standard Competition Ranking positions for a round, computed from CUMULATIVE
 * strokes through that round. ESPN's position_rN columns are not used: they are
 * assigned sequentially as golfers finish and never corrected, so a golfer tied
 * 2nd can show 7th. Ties share a position and the next distinct score skips
 * accordingly (1, T2, T2, 4...).
 */
function buildPositionMap(
  lb: RoundLbRow[],
  round: RoundKey,
): Map<string, number> {
  const cols = ROUND_COLS[round];
  const entries: Array<{ id: string; cumulative: number }> = [];

  for (const row of lb) {
    if (!row.golfer_id) continue;
    const vals = cols.map((c) => row[c] as number | null);
    if (vals.some((v) => v == null || (v as number) < MIN_COMPLETE)) continue;
    entries.push({
      id: row.golfer_id,
      cumulative: vals.reduce<number>((a, v) => a + (v as number), 0),
    });
  }

  entries.sort((a, b) => a.cumulative - b.cumulative);
  const map = new Map<string, number>();
  let rank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].cumulative !== entries[i - 1].cumulative) rank = i + 1;
    map.set(entries[i].id, rank);
  }
  return map;
}

function posDisplay(pos: number, tie: boolean): string {
  return tie ? `T${pos}` : `${pos}`;
}

/** Team standings for a round: best 5 of 7 SCR positions, then SCR-rank teams. */
function standingsFor(
  round: RoundKey,
  teamPicks: Map<string, Pick[]>,
  posMap: Map<string, number>,
  lbByGolfer: Map<string, RoundLbRow>,
  golferById: Map<string, Golfer>,
  nameOf: (id: string) => string,
): RoundTeam[] {
  // Cut only bites scoring from R3 onward (R2 is cut day but positions still
  // exist for everyone who played 36 holes).
  const cutApplies = round === "r3";

  const teams: RoundTeam[] = [];
  teamPicks.forEach((picks, teamId) => {
    const card: RoundGolfer[] = picks.map((p) => {
      const lb = lbByGolfer.get(p.golfer_id);
      const cut = lb ? isCut(lb) : false;
      const rawPos = posMap.get(p.golfer_id);
      // A golfer with no SCR position this round has no real score yet (blank
      // round, WD before teeing off). We fall back to 100, but flag it so
      // movement can exclude teams distorted by phantom scores.
      const missing = rawPos == null && !(cutApplies && cut);
      const points = cutApplies && cut ? CUT_POINTS : (rawPos ?? CUT_POINTS);
      return {
        golferId: p.golfer_id,
        name: lb?.espn_display_name ?? golferById.get(p.golfer_id)?.golfer_name ?? "Unknown",
        bucket: p.bucket,
        position: points,
        positionDisplay: cutApplies && cut ? "CUT" : String(rawPos ?? "-"),
        cut,
        counted: false,
        missing,
      };
    });
    card.sort((a, b) => a.position - b.position);
    card.forEach((c, i) => (c.counted = i < 5));
    const total = card.slice(0, 5).reduce((acc, c) => acc + c.position, 0);

    teams.push({
      teamId,
      team: nameOf(teamId),
      total,
      position: 0,
      positionDisplay: "",
      isTie: false,
      delta: null,
      previousPosition: null,
      card,
    });
  });

  teams.sort((a, b) => a.total - b.total || a.team.localeCompare(b.team));

  // SCR-rank teams by total
  let rank = 1;
  for (let i = 0; i < teams.length; i++) {
    if (i > 0 && teams[i].total === teams[i - 1].total) {
      teams[i].position = teams[i - 1].position;
      teams[i].isTie = true;
      teams[i - 1].isTie = true;
    } else {
      teams[i].position = rank;
    }
    teams[i].positionDisplay = posDisplay(teams[i].position, false); // tie flag set below
    rank++;
  }
  teams.forEach((t) => (t.positionDisplay = posDisplay(t.position, t.isTie)));
  return teams;
}

/**
 * Build a round report pack. PURE. Callers fetch and page.
 *
 * `round` is the round being reported. To compute movement, the engine also
 * needs the previous round, which it derives from the same leaderboard rows
 * (cumulative strokes are all present), so only one leaderboard fetch is needed.
 */
export function buildRoundPack(
  round: RoundKey,
  picks: Pick[],
  golfers: Golfer[],
  teams: Team[],
  leaderboard: RoundLbRow[],
): RoundPack {
  const roundNumber = round === "r1" ? 1 : round === "r2" ? 2 : 3;

  const golferById = new Map<string, Golfer>();
  golfers.forEach((g) => golferById.set(g.id, g));
  const teamNames: Record<string, string> = {};
  teams.forEach((t) => (teamNames[t.id] = t.nickname ?? "Unknown"));
  const nameOf = (id: string) => teamNames[id] ?? "Unknown";

  const lbByGolfer = new Map<string, RoundLbRow>();
  leaderboard.forEach((r) => {
    if (r.golfer_id) lbByGolfer.set(r.golfer_id, r);
  });

  const backerCount = new Map<string, number>();
  picks.forEach((p) => backerCount.set(p.golfer_id, (backerCount.get(p.golfer_id) ?? 0) + 1));

  const teamPicks = new Map<string, Pick[]>();
  picks.forEach((p) => {
    let list = teamPicks.get(p.team_id);
    if (!list) {
      list = [];
      teamPicks.set(p.team_id, list);
    }
    list.push(p);
  });

  const thisPos = buildPositionMap(leaderboard, round);
  const thisStandings = standingsFor(
    round,
    teamPicks,
    thisPos,
    lbByGolfer,
    golferById,
    nameOf,
  );

  // Movement vs previous round (R1 has none).
  let climbers: Mover[] = [];
  let fallers: Mover[] = [];
  if (round !== "r1") {
    const prevRound: RoundKey = round === "r3" ? "r2" : "r1";
    const prevPos = buildPositionMap(leaderboard, prevRound);
    const prevStandings = standingsFor(
      prevRound,
      teamPicks,
      prevPos,
      lbByGolfer,
      golferById,
      nameOf,
    );
    const prevRank = new Map<string, number>();
    prevStandings.forEach((t) => prevRank.set(t.teamId, t.position));

    thisStandings.forEach((t) => {
      const prev = prevRank.get(t.teamId);
      if (prev != null) {
        t.previousPosition = prev;
        t.delta = prev - t.position; // positive = climbed
      }
    });

    const moves = thisStandings
      .filter((t) => t.delta != null)
      // Skip teams we can't name (a late entry missing from the teams fetch):
      // surfacing "Unknown" as a headline mover reads as a bug.
      .filter((t) => t.team && t.team !== "Unknown")
      .map((t) => ({ team: t.team, from: t.previousPosition!, to: t.position, delta: t.delta! }));
    climbers = [...moves].filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    fallers = [...moves].filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  }

  const totals = thisStandings.map((t) => t.total);
  const fieldMedian = totals.length
    ? totals.length % 2
      ? totals[(totals.length - 1) / 2]
      : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
    : 0;

  // Real-golf leaders this round (actual tournament leaders by SCR position).
  const golfLeaders = Array.from(thisPos.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, 6)
    .map(([golferId, pos]) => {
      const lb = lbByGolfer.get(golferId);
      const tie = Array.from(thisPos.values()).filter((p) => p === pos).length > 1;
      return {
        name: lb?.espn_display_name ?? "Unknown",
        positionDisplay: posDisplay(pos, tie),
        pickedBy: backerCount.get(golferId) ?? 0,
      };
    });

  // Chalk watch: the most-picked golfers and where they sit this round.
  const chalkWatch = Array.from(backerCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([golferId, pickedBy]) => {
      const lb = lbByGolfer.get(golferId);
      const cut = lb ? isCut(lb) : false;
      const pos = thisPos.get(golferId);
      const tie = pos != null && Array.from(thisPos.values()).filter((p) => p === pos).length > 1;
      return {
        name: lb?.espn_display_name ?? golferById.get(golferId)?.golfer_name ?? "Unknown",
        positionDisplay: cut ? "CUT" : pos != null ? posDisplay(pos, tie) : "-",
        pickedBy,
      };
    });

  // Cut carnage (R2 is the cut round).
  const isCutRound = round === "r2";
  const cutGolfers = leaderboard.filter((r) => isCut(r));
  const notableCut = cutGolfers
    .map((r) => ({
      name: r.espn_display_name,
      positionDisplay: "CUT",
      pickedBy: r.golfer_id ? backerCount.get(r.golfer_id) ?? 0 : 0,
    }))
    .filter((c) => c.pickedBy > 0)
    .sort((a, b) => b.pickedBy - a.pickedBy)
    .slice(0, 6);

  const cutIds = new Set(cutGolfers.map((r) => r.golfer_id).filter(Boolean) as string[]);
  const hardestHit = Array.from(teamPicks.entries())
    .map(([teamId, ps]) => ({
      team: nameOf(teamId),
      cutCount: ps.filter((p) => cutIds.has(p.golfer_id)).length,
    }))
    .filter((t) => t.cutCount > 0)
    .sort((a, b) => b.cutCount - a.cutCount)
    .slice(0, 5);

  return {
    round,
    roundNumber,
    leader: thisStandings[0] ?? null,
    top: thisStandings.slice(0, 10),
    fieldMedian,
    entryCount: thisStandings.length,
    climbers,
    fallers,
    hasMovement: climbers.length > 0 || fallers.length > 0,
    golfLeaders,
    chalkWatch,
    cut: {
      isCutRound,
      totalCut: cutGolfers.length,
      fieldSize: leaderboard.length,
      notableCut: isCutRound ? notableCut : [],
      hardestHit: isCutRound ? hardestHit : [],
    },
    teamNames,
  };
}
