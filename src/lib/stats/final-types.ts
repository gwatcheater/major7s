/**
 * Types for the End of Round / Final report engine (buildFinalPack).
 *
 * This is the SCORING side, distinct from buildStatsPack which is picks-only.
 * It joins picks to leaderboard results to tell the story of what happened to
 * everyone's choices.
 *
 * Leaderboard column encoding (from tournament_leaderboard):
 *   status_type:      STATUS_FINISH | STATUS_CUT | STATUS_WD | STATUS_IN_PROGRESS
 *   position_numeric: integer for finishers, EMPTY STRING for cut/withdrawn.
 *                     A cut or WD golfer scores 100 in Major7s (best-5-of-7).
 *   position_display: "T7", "1", or a dash for cut. Use for display only.
 *
 * Team totals are read from tournament_scores.total_points (the app's official
 * figure), NOT recomputed. The per-golfer breakdown below is reconstructed from
 * the leaderboard so we can show which 5 of 7 counted; that reconstruction has
 * been verified to match the official totals exactly (107/107 for the US Open).
 */

export interface LeaderboardRow {
  golfer_id: string;
  espn_display_name: string;
  position_numeric: number | null; // null = cut/withdrawn
  position_display: string;
  status_type: string;
  score_to_par: number | null;
  withdrew_after_round: number | null;
}

export interface ScoreRow {
  team_id: string;
  total_points: number;
  thru_cut: number | null;
  position_numeric: number | null;
  position_display: string;
}

/** A single golfer within a team's scored card. */
export interface CardGolfer {
  golferId: string;
  name: string;
  bucket: number;
  /** Major7s points: finishing position, or 100 for CUT/WD. */
  points: number;
  positionDisplay: string; // "T7", "CUT"
  cut: boolean;
  /** True for the best 5 that counted toward the team total. */
  counted: boolean;
}

export interface ScoredTeam {
  teamId: string;
  team: string;
  total: number;
  positionDisplay: string;
  positionNumeric: number | null;
  card: CardGolfer[]; // 7 golfers, sorted best -> worst
  countedTotal: number; // sum of the best 5 (== total)
  cutCount: number; // how many of their 7 missed the cut
  survivorCount: number; // how many of their 7 made the cut (7 - cutCount)
  debutant: boolean; // first-ever Major7s entry (set by caller from RPC)
}

/**
 * Best of the Rest. A separate consolation competition for teams that lost 3+
 * picks to the cut (survivorCount < 5), so they never had a clean best-5.
 * Ranked by the team's official total, same as the main event. The bite is that
 * a BOTR winner can still out-score fully-intact teams despite carrying a forced
 * 100 - that comparison is beatFullTeams.
 */
export interface BotrEntry {
  teamId: string;
  team: string;
  total: number;
  survivorCount: number;
  survivors: CardGolfer[]; // the golfers who made the cut, best first
}

export interface Botr {
  fieldSize: number; // teams eligible (survivorCount < 5)
  winner: BotrEntry | null;
  /** How many fully-intact teams (5+ survivors) the winner still out-scored. */
  beatFullTeams: number;
  fullTeamCount: number; // total teams with 5+ survivors
}

export interface GolferOutcome {
  golferId: string;
  name: string;
  bucket: number;
  positionDisplay: string;
  points: number;
  cut: boolean;
  pickedBy: number; // how many teams picked them
}

export interface FinalPack {
  status: "final" | "in_progress";
  roundsCompleted: number;

  podium: ScoredTeam[]; // top 3
  woodenSpoon: ScoredTeam | null; // last place

  winner: ScoredTeam | null;
  /** How the winner's total compares to the field. */
  winningMargin: number | null; // points clear of 2nd
  fieldMedian: number;

  /** Golfers ranked by how they scored, among those someone picked. */
  bestPicks: GolferOutcome[]; // lowest points, most picked first
  worstPicks: GolferOutcome[]; // the detonations: high points, many backers

  /** The chalk report card: how the most-picked golfers actually finished. */
  chalkOutcomes: GolferOutcome[];

  /** Lone-wolf outcomes: golfers with exactly one backer and how they did. */
  loneWolfOutcomes: Array<GolferOutcome & { backer: string }>;

  /** Cut carnage. */
  totalCut: number;
  fieldSize: number;
  /** Teams whose picks were hit hardest by the cut. */
  cutHit: Array<{ team: string; cutCount: number; total: number }>;

  /** Best of the Rest consolation competition. */
  botr: Botr;

  /** Podium finishers who are playing Major7s for the first time. */
  debutantsOnPodium: Array<{ team: string; positionDisplay: string; total: number }>;

  teamNames: Record<string, string>;
}
