/**
 * Types for the in-tournament Round reports (R1, R2, R3).
 *
 * Distinct from buildFinalPack: mid-tournament there are no official totals and
 * no final positions, so team standings are computed from Standard Competition
 * Ranking (SCR) positions, which are themselves recomputed from cumulative
 * strokes because ESPN's position_rN columns are NOT correct SCR (they are
 * assigned sequentially as golfers finish and never corrected for ties).
 *
 * Movement deltas compare this round's team standing to the previous round's.
 * A positive delta means the team climbed (a better, lower position number).
 */

export type RoundKey = "r1" | "r2" | "r3";

export interface RoundLbRow {
  golfer_id: string | null;
  espn_display_name: string;
  status_type: string; // STATUS_CUT / STATUS_WD matter from R3
  status_short_detail: string | null; // distinguishes WD from CUT
  round_1: number | null;
  round_2: number | null;
  round_3: number | null;
  round_4: number | null;
}

export interface RoundGolfer {
  golferId: string;
  name: string;
  bucket: number;
  position: number; // SCR position this round, or 100 if cut (R3+)
  positionDisplay: string; // "T4", "CUT"
  cut: boolean;
  counted: boolean; // one of the best 5
  missing?: boolean; // no real score this round (fallback to 100)
}

export interface RoundTeam {
  teamId: string;
  team: string;
  total: number; // best 5 of 7 SCR positions this round
  position: number; // team's SCR rank this round
  positionDisplay: string; // "T3"
  isTie: boolean;
  delta: number | null; // previous round position - this; positive = climbed
  previousPosition: number | null;
  card: RoundGolfer[]; // 7 golfers, best first
}

export interface Mover {
  team: string;
  from: number;
  to: number;
  delta: number; // positive = climbed
}

export interface RoundGolferNote {
  name: string;
  positionDisplay: string;
  pickedBy: number;
}

export interface RoundPack {
  round: RoundKey;
  roundNumber: number;

  leader: RoundTeam | null;
  top: RoundTeam[]; // top 10
  fieldMedian: number;
  entryCount: number;

  /** Biggest climbers and fallers vs the previous round (null on R1). */
  climbers: Mover[];
  fallers: Mover[];
  hasMovement: boolean;

  /** Real-golf leaders this round (the actual tournament, not Major7s teams). */
  golfLeaders: Array<{ name: string; positionDisplay: string; pickedBy: number }>;

  /** Popular picks doing well / badly this round - the chalk watch. */
  chalkWatch: RoundGolferNote[];

  /** R2 only: cut carnage. Populated when this round is the cut (R2). */
  cut: {
    isCutRound: boolean;
    totalCut: number;
    fieldSize: number;
    /** Most-picked golfers who missed the cut. */
    notableCut: RoundGolferNote[];
    /** Teams hit hardest by the cut. */
    hardestHit: Array<{ team: string; cutCount: number }>;
  };

  teamNames: Record<string, string>;
}
