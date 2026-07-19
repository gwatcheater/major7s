import type { Golfer, Pick, Team } from "./types";
import type {
  Botr,
  BotrEntry,
  CardGolfer,
  FinalPack,
  GolferOutcome,
  LeaderboardRow,
  ScoredTeam,
  ScoreRow,
} from "./final-types";

/**
 * Build the scoring-side pack for an End of Round / Final report.
 *
 * PURE. Callers fetch and page (Supabase caps at 1,000 rows; picks, golfers and
 * the leaderboard all breach it at scale). Given the same rows it always returns
 * the same pack.
 *
 * Team totals come from `scores` (the app's official figure). The per-golfer
 * card is reconstructed from the leaderboard purely for storytelling - which 5
 * of 7 counted, which pick detonated - and has been verified to match the
 * official totals exactly.
 *
 * CUT/WD golfers score 100. In the leaderboard they carry status STATUS_CUT or
 * STATUS_WD and an EMPTY position_numeric, so never parseInt the position blind.
 */
export function buildFinalPack(
  picks: Pick[],
  golfers: Golfer[],
  teams: Team[],
  leaderboard: LeaderboardRow[],
  scores: ScoreRow[],
  roundsCompleted: number,
  debutantTeamIds: Set<string> = new Set(),
): FinalPack {
  const CUT_POINTS = 100;
  const BOTR_SURVIVOR_THRESHOLD = 5; // fewer than 5 survivors => BOTR field

  const golferById = new Map<string, Golfer>();
  golfers.forEach((g) => golferById.set(g.id, g));

  const teamNames: Record<string, string> = {};
  teams.forEach((t) => (teamNames[t.id] = t.nickname ?? "Unknown"));
  const nameOf = (id: string) => teamNames[id] ?? "Unknown";

  // golfer_id -> result
  const result = new Map<
    string,
    { points: number; positionDisplay: string; cut: boolean; name: string }
  >();
  leaderboard.forEach((r) => {
    const cut = r.status_type === "STATUS_CUT" || r.status_type === "STATUS_WD";
    const points = cut ? CUT_POINTS : (r.position_numeric ?? CUT_POINTS);
    result.set(r.golfer_id, {
      points,
      positionDisplay: cut ? "CUT" : r.position_display,
      cut,
      name: r.espn_display_name,
    });
  });

  // golfer_id -> backer count
  const backerCount = new Map<string, number>();
  picks.forEach((p) => backerCount.set(p.golfer_id, (backerCount.get(p.golfer_id) ?? 0) + 1));

  // official team totals
  const officialByTeam = new Map<string, ScoreRow>();
  scores.forEach((s) => officialByTeam.set(s.team_id, s));

  // team_id -> picks
  const teamPicks = new Map<string, Pick[]>();
  picks.forEach((p) => {
    let list = teamPicks.get(p.team_id);
    if (!list) {
      list = [];
      teamPicks.set(p.team_id, list);
    }
    list.push(p);
  });

  // ---- build scored cards ---------------------------------------------
  const scored: ScoredTeam[] = [];
  teamPicks.forEach((tPicks, teamId) => {
    const official = officialByTeam.get(teamId);
    // Only teams that have an official score are ranked (a team may exist in
    // picks but not yet be scored on an in-progress event).
    if (!official) return;

    const card: CardGolfer[] = tPicks
      .map((p) => {
        const r = result.get(p.golfer_id);
        const g = golferById.get(p.golfer_id);
        return {
          golferId: p.golfer_id,
          name: r?.name ?? g?.golfer_name ?? "Unknown",
          bucket: p.bucket,
          points: r?.points ?? CUT_POINTS,
          positionDisplay: r?.positionDisplay ?? "CUT",
          cut: r?.cut ?? true,
          counted: false,
        };
      })
      .sort((a, b) => a.points - b.points);

    card.forEach((c, i) => (c.counted = i < 5));
    const countedTotal = card.slice(0, 5).reduce((acc, c) => acc + c.points, 0);

    const cutCount = card.filter((c) => c.cut).length;
    scored.push({
      teamId,
      team: nameOf(teamId),
      total: official.total_points,
      positionDisplay: official.position_display,
      positionNumeric: official.position_numeric,
      card,
      countedTotal,
      cutCount,
      survivorCount: card.length - cutCount,
      debutant: debutantTeamIds.has(teamId),
    });
  });

  scored.sort((a, b) => a.total - b.total || a.team.localeCompare(b.team));

  const totals = scored.map((s) => s.total);
  const fieldMedian = totals.length
    ? totals.length % 2
      ? totals[(totals.length - 1) / 2]
      : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
    : 0;

  const podium = scored.slice(0, 3);
  const winner = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  const woodenSpoon = scored.length ? scored[scored.length - 1] : null;
  const winningMargin =
    winner && runnerUp ? runnerUp.total - winner.total : null;

  // ---- golfer outcomes among picked golfers ---------------------------
  const outcomes: GolferOutcome[] = Array.from(backerCount.entries())
    .map(([golferId, pickedBy]) => {
      const r = result.get(golferId);
      const g = golferById.get(golferId);
      return {
        golferId,
        name: r?.name ?? g?.golfer_name ?? "Unknown",
        bucket:
          picks.find((p) => p.golfer_id === golferId)?.bucket ??
          g?.bucket_number ??
          0,
        positionDisplay: r?.positionDisplay ?? "CUT",
        points: r?.points ?? CUT_POINTS,
        cut: r?.cut ?? true,
        pickedBy,
      };
    })
    .filter((o) => o.bucket > 0);

  // Best picks: lowest points, tie-broken by most picked (a popular golfer who
  // delivered is a better story than an obscure one).
  const bestPicks = [...outcomes]
    .filter((o) => !o.cut)
    .sort((a, b) => a.points - b.points || b.pickedBy - a.pickedBy)
    .slice(0, 6);

  // Worst picks: the detonations. High points AND many backers - a chalk pick
  // that missed the cut hurt a lot of teams at once.
  const worstPicks = [...outcomes]
    .sort((a, b) => b.points - a.points || b.pickedBy - a.pickedBy)
    .filter((o) => o.points >= CUT_POINTS || o.points >= 50)
    .sort((a, b) => b.pickedBy - a.pickedBy || b.points - a.points)
    .slice(0, 6);

  // Chalk report card: the most-picked golfers and how they actually did.
  const chalkOutcomes = [...outcomes]
    .sort((a, b) => b.pickedBy - a.pickedBy)
    .slice(0, 8);

  // Lone wolves: exactly one backer, and how the punt paid off.
  const backerTeamOf = new Map<string, string>();
  picks.forEach((p) => {
    // last writer wins; fine because lone wolves have exactly one backer
    if ((backerCount.get(p.golfer_id) ?? 0) === 1) backerTeamOf.set(p.golfer_id, p.team_id);
  });
  const loneWolfOutcomes = outcomes
    .filter((o) => o.pickedBy === 1)
    .sort((a, b) => a.points - b.points)
    .map((o) => ({ ...o, backer: nameOf(backerTeamOf.get(o.golferId) ?? "") }));

  // Cut carnage.
  const totalCut = leaderboard.filter(
    (r) => r.status_type === "STATUS_CUT" || r.status_type === "STATUS_WD",
  ).length;

  const cutHit = [...scored]
    .filter((s) => s.cutCount > 0)
    .sort((a, b) => b.cutCount - a.cutCount || a.total - b.total)
    .slice(0, 5)
    .map((s) => ({ team: s.team, cutCount: s.cutCount, total: s.total }));

  // ---- Best of the Rest ----------------------------------------------
  // Field = teams that lost 3+ picks to the cut (fewer than 5 survivors), so
  // they were forced to count at least one 100 and never had a clean best-5.
  // Ranked by official total, exactly like the main event.
  const botrField = scored.filter((s) => s.survivorCount < BOTR_SURVIVOR_THRESHOLD);
  const botrSorted = [...botrField].sort((a, b) => a.total - b.total);
  const botrWinnerTeam = botrSorted[0] ?? null;

  const fullTeams = scored.filter((s) => s.survivorCount >= BOTR_SURVIVOR_THRESHOLD);
  const beatFullTeams = botrWinnerTeam
    ? fullTeams.filter((s) => s.total > botrWinnerTeam.total).length
    : 0;

  const botrWinner: BotrEntry | null = botrWinnerTeam
    ? {
        teamId: botrWinnerTeam.teamId,
        team: botrWinnerTeam.team,
        total: botrWinnerTeam.total,
        survivorCount: botrWinnerTeam.survivorCount,
        survivors: botrWinnerTeam.card.filter((c) => !c.cut),
      }
    : null;

  const botr: Botr = {
    fieldSize: botrField.length,
    winner: botrWinner,
    beatFullTeams,
    fullTeamCount: fullTeams.length,
  };

  const debutantsOnPodium = podium
    .filter((s) => s.debutant)
    .map((s) => ({ team: s.team, positionDisplay: s.positionDisplay, total: s.total }));

  return {
    status: roundsCompleted >= 4 ? "final" : "in_progress",
    roundsCompleted,
    podium,
    woodenSpoon,
    winner,
    winningMargin,
    fieldMedian,
    bestPicks,
    worstPicks,
    chalkOutcomes,
    loneWolfOutcomes,
    totalCut,
    fieldSize: leaderboard.length,
    cutHit,
    botr,
    debutantsOnPodium,
    teamNames,
  };
}
