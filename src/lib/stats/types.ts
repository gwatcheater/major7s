/**
 * Shared types for the Major7s stats engine.
 *
 * Column names mirror the database exactly:
 *   picks:   team_id, tournament_id, bucket, golfer_id,
 *            submitted_at, last_edited_at, tweak_count
 *   golfers: id, golfer_name, owgr_rank, bucket_number, tournament_id
 *   teams:   id, nickname
 */

export interface Pick {
  team_id: string;
  bucket: number;
  golfer_id: string;
  submitted_at: string;
  last_edited_at: string;
  /**
   * NOTE: this is a TEAM-level counter denormalised onto all 7 of a team's pick
   * rows. Every row for a team carries the same value. Aggregate with MAX.
   * Summing it multiplies the real figure by 7.
   */
  tweak_count: number | null;
}

export interface Golfer {
  id: string;
  golfer_name: string;
  owgr_rank: number | null;
  bucket_number: number | null;
}

export interface Team {
  id: string;
  nickname: string;
}

export interface BucketConcentration {
  bucket: number;
  /** Golfers assigned to this bucket for this tournament. */
  available: number;
  /** Distinct golfers in this bucket picked by at least one team. */
  picked: number;
  topGolferId: string;
  topName: string;
  topCount: number;
  /** Golfers in this bucket backed by exactly one team. */
  uniques: number;
}

export interface PopularPick {
  golferId: string;
  name: string;
  owgr: number | null;
  bucket: number | null;
  count: number;
  teamIds: string[];
}

export interface HerdModal {
  bucket: number;
  golferId: string;
  name: string;
  count: number;
}

export interface HerdMatch {
  teamId: string;
  matched: number;
  deviates: number[];
}

export interface Herd {
  modal: HerdModal[];
  closest: HerdMatch[];
  anyPerfect: boolean;
}

export interface WolfRow {
  teamId: string;
  avg: number;
}

export interface Wolf {
  rows: WolfRow[];
  min: number;
  max: number;
  median: number;
  rarestTeamId: string | null;
  chalkiestTeamId: string | null;
  ratio: number;
  under15: number;
  over30: number;
}

export interface ComboEntry {
  key: string;
  golferIds: string[];
  names: string[];
  teamIds: string[];
}

export interface ComboSection {
  k: number;
  entries: ComboEntry[];
}

export interface NearMiss {
  a: string;
  b: string;
  shared: number;
}

export interface Overlap {
  /** Groups of team ids with byte-identical picks. */
  identical: string[][];
  near: NearMiss[];
  /** Mean shared picks between any two entries. The noise floor. */
  avg: number;
}

export interface UniqueItem {
  golferId: string;
  name: string;
  owgr: number | null;
  teamId: string;
}

export interface UniqueBucket {
  bucket: number;
  items: UniqueItem[];
}

export interface TimingRow {
  teamId: string;
  submitted: number;
  edited: number;
  tweaks: number;
}

export interface Timings {
  first: TimingRow | null;
  last: TimingRow | null;
  tweakers: TimingRow[];
  editors: TimingRow[];
  untouched: number;
  total: number;
}

export interface StatsPack {
  entryCount: number;
  fieldSize: number;
  distinctPicked: number;
  uniqueTotal: number;
  bucketConcentration: BucketConcentration[];
  mostPopular: PopularPick[];
  herd: Herd;
  wolf: Wolf;
  comboSections: ComboSection[];
  overlap: Overlap;
  uniqueByBucket: UniqueBucket[];
  timings: Timings;
  /** teamId -> nickname, so consumers can render names without re-joining. */
  teamNames: Record<string, string>;
}

export const BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
