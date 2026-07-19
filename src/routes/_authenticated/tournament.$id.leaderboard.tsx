import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonation } from "@/context/impersonation-context";
import { useTeams } from "@/hooks/use-teams";
import {
  buildRoundPositionMap,
  computeRoundScores,
  getInProgressRound,
  isCutOrWithdrawn,
  isWithdrawn,
  NON_FINISHER_POINTS,
  type Round,
  type RoundPickScore,
  type RoundTeamScore,
} from "@/lib/major7s-round-scoring";

// VERSION MARKER: leaderboard v5.1 — Tournament view round positions now
// recomputed via buildRoundPositionMap (shared with Major7s scoring and the
// admin export panel) instead of raw ESPN position_rN snapshots, which
// don't merge ties correctly. If you see this comment in the deployed
// bundle, you're on the right version.

export const Route = createFileRoute("/_authenticated/tournament/$id/leaderboard")({
  component: LeaderboardView,
});

type View = "tournament" | "major7s";

interface LbRow {
  id: string;
  golfer_id: string | null;
  espn_display_name: string;
  country: string | null;
  position_display: string | null;
  position_numeric: number | null;
  is_tie: boolean;
  status_type: string | null;
  status_short_detail: string | null;
  total_strokes: number | null;
  score_to_par: number | null;
  round_1: number | null;
  round_2: number | null;
  round_3: number | null;
  round_4: number | null;
  // Per-round positions captured at the end of each round, from ESPN's
  // linescores[].currentPosition. NULL when the round wasn't played (CUT/WD
  // past that point) or when the tournament's ESPN archive lacks this data.
  position_r1: number | null;
  position_r2: number | null;
  position_r3: number | null;
  position_r4: number | null;
}

function fmtToPar(v: number | null): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: "—", cls: "text-muted-foreground" };
  if (v === 0) return { text: "E", cls: "text-foreground" };
  if (v < 0) return { text: String(v), cls: "text-red-600 font-semibold" };
  return { text: `+${v}`, cls: "text-foreground" };
}

// Shared column widths for ALL Major7s tables (panel, leaderboard, breakdown).
// Identical widths + tableLayout:fixed guarantee column alignment across them.
// When showDelta is true a 36px Δ column sits between Pos and Team.
function MajorCols({ showDelta = false }: { showDelta?: boolean }) {
  return (
    <colgroup>
      <col style={{ width: "52px" }} />
      {showDelta && <col style={{ width: "36px" }} />}
      <col />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "32px" }} />
    </colgroup>
  );
}



/** Shared Δ cell — mirrors the tournament-view rendering exactly. */
function Major7sDeltaCell({ delta }: { delta: number | null }) {
  if (delta === null || delta === undefined || delta === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (delta > 0) {
    return <span className="text-green-600 font-semibold">↑{delta}</span>;
  }
  return <span className="text-red-600 font-semibold">↓{-delta}</span>;
}

function LeaderboardView() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const { activeTeam } = useTeams();
  const effectiveUserId = getEffectiveUserId(user?.id);
  const [view, setView] = useState<View>("major7s");
  // Round selector — defaults to "r4" (the tournament's settled view).
  // Shared across both Major7s and Tournament views so switching views
  // doesn't reset the user's round selection.
  const [round, setRound] = useState<Round>("r4");

  const { data: tournament } = useQuery({
    queryKey: ["tournament-leaderboard-header", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments").select("id, name, location, status").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["tournament-leaderboard", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_leaderboard")
        .select("id, golfer_id, espn_display_name, country, position_display, position_numeric, is_tie, status_type, status_short_detail, total_strokes, score_to_par, round_1, round_2, round_3, round_4, position_r1, position_r2, position_r3, position_r4")
        .eq("tournament_id", id);
      if (error) throw error;
      return (data ?? []) as LbRow[];
    },
  });

  const { data: myPickGolferIds = new Set<string>() } = useQuery({
    queryKey: ["my-picks-golfer-ids", activeTeam?.id, id],
    enabled: !!activeTeam?.id && !!effectiveUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks").select("golfer_id")
        .eq("team_id", activeTeam!.id)
        .eq("tournament_id", id);
      if (error) throw error;
      return new Set<string>((data ?? []).map((p: any) => p.golfer_id).filter(Boolean));
    },
  });

  // Determine how many rounds have ESPN position data. Controls which tabs
  // appear in the round toggle. Only shows a round once that round's import
  // has populated position_r{n}. Also gates BOTR (R3/Final only) naturally —
  // R3 tab won't appear until the cut has happened.
  // Determine how many rounds have ESPN position data. Controls which tabs
  // appear in the round toggle. Also detects the post-R2 cut state: if R2
  // position data exists and the field has been cut (>5 players with CUT/WD
  // status), the R3 tab and BOTR toggle should be available even before any
  // R3 position data exists. CUT players score 100 and non-CUT players carry
  // forward their R2 positions in the R3 view.
  const maxRound = useMemo(() => {
    let max = 0;
    let cutCount = 0;
    for (const r of rows) {
      if (r.position_r1 !== null && max < 1) max = 1;
      if (r.position_r2 !== null && max < 2) max = 2;
      if (r.position_r3 !== null && max < 3) max = 3;
      if (r.position_r4 !== null) { max = 4; break; }
      if (isCutOrWithdrawn(r.status_type)) cutCount++;
    }
    // Post-cut: R2 data exists + field has been cut → surface R3 view
    if (max === 2 && cutCount > 5) max = 3;
    return max;
  }, [rows]);
  const hasRoundData = maxRound >= 1;

  // If the user is on a round that doesn't have data yet (e.g. navigating
  // from a completed tournament to a live one, or after first ESPN import),
  // snap to the latest available round.
  useEffect(() => {
    if (maxRound === 0) return; // data not loaded yet — leave default
    const roundNum = round === "r1" ? 1 : round === "r2" ? 2 : round === "r3" ? 3 : 4;
    if (roundNum > maxRound) {
      const latest: Round = maxRound === 1 ? "r1" : maxRound === 2 ? "r2" : maxRound === 3 ? "r3" : "r4";
      setRound(latest);
    }
  }, [maxRound]);

  // Which round (if any) is currently live — governs whether
  // buildRoundPositionMap trusts ESPN's live position_rN or recomputes
  // from cumulative strokes. Shared across grouping, tie detection, and Δ.
  const inProgressRound = useMemo(() => getInProgressRound(rows), [rows]);

  // Recomputed Standard Competition Ranking positions for the round on
  // screen, and for the previous round (needed for Δ, and for R4's Δ which
  // compares against R3). NOT the raw position_rN column — see
  // buildRoundPositionMap's docstring: ESPN's per-round snapshot is taken
  // as each golfer finishes and never corrected for ties afterwards, so
  // trusting it directly produces wrong positions once a round settles.
  const roundPosMap = useMemo(() => {
    if (round === "r4") return null; // R4 Tournament view uses ESPN's final, already-settled position_numeric/is_tie
    return buildRoundPositionMap(rows, round, inProgressRound);
  }, [rows, round, inProgressRound]);

  const prevRoundPosMap = useMemo(() => {
    const prevRound: Round | null =
      round === "r2" ? "r1" : round === "r3" ? "r2" : round === "r4" ? "r3" : null;
    if (!prevRound) return null;
    return buildRoundPositionMap(rows, prevRound, inProgressRound);
  }, [rows, round, inProgressRound]);

  // Round-aware grouping + sorting of leaderboard rows.
  const { active, cut } = useMemo(() => {
    // R4 view: CUT/WD in their own bottom group. Uses ESPN's final settled
    // position_numeric/is_tie — those ARE corrected for ties at close, unlike
    // the per-round position_rN snapshots.
    if (round === "r4") {
      const a: LbRow[] = [];
      const c: LbRow[] = [];
      for (const r of rows) {
        if (isCutOrWithdrawn(r.status_type)) c.push(r);
        else a.push(r);
      }
      a.sort((x, y) => {
        const xp = x.position_numeric ?? 9999;
        const yp = y.position_numeric ?? 9999;
        if (xp !== yp) return xp - yp;
        const xt = x.total_strokes ?? 9999;
        const yt = y.total_strokes ?? 9999;
        if (xt !== yt) return xt - yt;
        return x.espn_display_name.localeCompare(y.espn_display_name);
      });
      c.sort((x, y) => {
        const xp = x.score_to_par ?? 9999;
        const yp = y.score_to_par ?? 9999;
        if (xp !== yp) return xp - yp;
        const xt = x.total_strokes ?? 9999;
        const yt = y.total_strokes ?? 9999;
        if (xt !== yt) return xt - yt;
        return x.espn_display_name.localeCompare(y.espn_display_name);
      });
      return { active: a, cut: c };
    }

    // Round view (r1 / r2 / r3): filter to rows present in the recomputed
    // position map for this round, sort by that recomputed position. No
    // "cut" bucket — players outside this set simply hadn't played this
    // round (or had already left the field).
    const posMap = roundPosMap!;
    const a: LbRow[] = [];
    for (const r of rows) {
      if (posMap.has(r.golfer_id ?? r.id)) a.push(r);
    }
    a.sort((x, y) => {
      const xp = posMap.get(x.golfer_id ?? x.id) ?? 9999;
      const yp = posMap.get(y.golfer_id ?? y.id) ?? 9999;
      if (xp !== yp) return xp - yp;
      return x.espn_display_name.localeCompare(y.espn_display_name);
    });
    return { active: a, cut: [] };
  }, [rows, round, roundPosMap]);

  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto">
      <Link
        to="/tournament/$id"
        params={{ id }}
        className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {tournament?.name ?? "Tournament"}
      </Link>

      <header className="mt-4 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
          Leaderboard
        </p>
        <h1 className="font-display text-3xl md:text-4xl uppercase mt-1">
          {tournament?.name ?? "Tournament"}
        </h1>
      </header>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div className="inline-flex rounded-md border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setView("major7s")}
            className={`px-4 py-1.5 text-xs uppercase tracking-widest font-bold rounded ${
              view === "major7s" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Major7s
          </button>
          <button
            type="button"
            onClick={() => setView("tournament")}
            className={`px-4 py-1.5 text-xs uppercase tracking-widest font-bold rounded ${
              view === "tournament" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Tournament
          </button>
        </div>

        {/* Round toggle — shown on both Tournament and Major7s views when
            per-round position data exists. Hidden entirely when the tournament
            has no per-round data (older ESPN archives). */}
        {hasRoundData && (view === "tournament" || view === "major7s") && (
          <RoundToggle
            round={round}
            onChange={setRound}
            maxRound={maxRound}
          />
        )}
      </div>

      {view === "major7s" ? (
        <MajorSevensTable tournamentId={id} myTeamId={activeTeam?.id ?? null} round={round} lbRows={rows} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground p-4">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground p-4">
          No leaderboard data yet. An admin can import the final results from the tournament admin page.
        </p>
      ) : (
        <TournamentTable
          active={active}
          cut={cut}
          myPickGolferIds={myPickGolferIds}
          round={round}
          roundPosMap={roundPosMap}
          prevRoundPosMap={prevRoundPosMap}
        />
      )}
    </div>
  );
}

// =============================================================
// ROUND TOGGLE
// =============================================================
function RoundToggle({
  round, onChange, maxRound,
}: {
  round: Round;
  onChange: (r: Round) => void;
  maxRound: number;
}) {
  const allItems: { value: Round; label: string; minRound: number }[] = [
    { value: "r1", label: "R1", minRound: 1 },
    { value: "r2", label: "R2", minRound: 2 },
    { value: "r3", label: "R3", minRound: 3 },
    { value: "r4", label: "R4", minRound: 4 },
  ];
  const items = allItems.filter((it) => it.minRound <= maxRound);
  if (items.length <= 1) return null; // Single tab is pointless
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-1">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded ${
            round === it.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// =============================================================
// TOURNAMENT VIEW (ESPN leaderboard)
// =============================================================
function TourneyCols({
  showDelta, showToPar, showR1, showR2, showR3, showR4,
}: {
  showDelta: boolean;
  showToPar: boolean;
  showR1: boolean;
  showR2: boolean;
  showR3: boolean;
  showR4: boolean;
}) {
  // Column widths. Δ sits between POS and GOLFER for visual clarity — the
  // movement value belongs next to the position, not floating mid-row.
  return (
    <colgroup>
      <col style={{ width: "36px" }} />
      {showDelta && <col style={{ width: "36px" }} />}
      <col />
      {showToPar && <col style={{ width: "56px" }} />}
      {showR1 && <col style={{ width: "30px" }} />}
      {showR2 && <col style={{ width: "30px" }} />}
      {showR3 && <col style={{ width: "30px" }} />}
      {showR4 && <col style={{ width: "36px" }} />}
    </colgroup>
  );
}

function TournamentTable({
  active, cut, myPickGolferIds, round, roundPosMap, prevRoundPosMap,
}: {
  active: LbRow[];
  cut: LbRow[];
  myPickGolferIds: Set<string>;
  round: Round;
  roundPosMap: Map<string, number> | null;
  prevRoundPosMap: Map<string, number> | null;
}) {
  const showR1 = true;
  const showR2 = round === "r2" || round === "r3" || round === "r4";
  const showR3 = round === "r3" || round === "r4";
  const showR4 = round === "r4";
  const showToPar = round === "r4";
  // Δ = movement from previous round. R1 has no prior round to compare to.
  const showDelta = round !== "r1";

  // Tie detection for round views. Final view uses the row's `is_tie` flag
  // directly (computed by ESPN). For r1/r2/r3, roundPosMap already assigns
  // the same recomputed SCR position to tied golfers, so a tie is just any
  // position value that appears more than once in the map.
  const tiedPositions = useMemo<Set<number>>(() => {
    if (round === "r4" || !roundPosMap) return new Set();
    const counts = new Map<number, number>();
    for (const pos of roundPosMap.values()) {
      counts.set(pos, (counts.get(pos) ?? 0) + 1);
    }
    const ties = new Set<number>();
    for (const [pos, count] of counts) {
      if (count > 1) ties.add(pos);
    }
    return ties;
  }, [roundPosMap, round]);

  const colCount = 2
    + (showDelta ? 1 : 0)
    + (showToPar ? 1 : 0)
    + (showR1 ? 1 : 0)
    + (showR2 ? 1 : 0)
    + (showR3 ? 1 : 0)
    + (showR4 ? 1 : 0);

  return (
    <div className="border border-border bg-card">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <TourneyCols
          showDelta={showDelta}
          showToPar={showToPar}
          showR1={showR1}
          showR2={showR2}
          showR3={showR3}
          showR4={showR4}
        />
        <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-2">Pos</th>
            {showDelta && <th className="text-center px-1 py-2" title="Position change from previous round">Δ</th>}
            <th className="text-left px-2 py-2">Golfer</th>
            {showToPar && <th className="text-right px-2 py-2 whitespace-nowrap">To Par</th>}
            {showR1 && <th className="text-right px-1 py-2">R1</th>}
            {showR2 && <th className="text-right px-1 py-2">R2</th>}
            {showR3 && <th className="text-right px-1 py-2">R3</th>}
            {showR4 && <th className="text-right pl-1 pr-3 py-2">R4</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {active.map((r) => (
            <TourneyRow
              key={r.id}
              r={r}
              mine={!!r.golfer_id && myPickGolferIds.has(r.golfer_id)}
              round={round}
              tiedPositions={tiedPositions}
              roundPosMap={roundPosMap}
              prevRoundPosMap={prevRoundPosMap}
              showDelta={showDelta}
              showToPar={showToPar}
              showR1={showR1}
              showR2={showR2}
              showR3={showR3}
              showR4={showR4}
            />
          ))}
          {cut.length > 0 && (
            <>
              <tr className="bg-muted/30">
                <td colSpan={colCount} className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                  Missed Cut / Withdrew
                </td>
              </tr>
              {cut.map((r) => (
                <TourneyRow
                  key={r.id}
                  r={r}
                  mine={!!r.golfer_id && myPickGolferIds.has(r.golfer_id)}
                  dim
                  round={round}
                  tiedPositions={tiedPositions}
                  roundPosMap={roundPosMap}
                  prevRoundPosMap={prevRoundPosMap}
                  showDelta={showDelta}
                  showToPar={showToPar}
                  showR1={showR1}
                  showR2={showR2}
                  showR3={showR3}
                  showR4={showR4}
                />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TourneyRow({
  r, mine, dim, round, tiedPositions, roundPosMap, prevRoundPosMap, showDelta, showToPar, showR1, showR2, showR3, showR4,
}: {
  r: LbRow;
  mine: boolean;
  dim?: boolean;
  round: Round;
  tiedPositions: Set<number>;
  roundPosMap: Map<string, number> | null;
  prevRoundPosMap: Map<string, number> | null;
  showDelta: boolean;
  showToPar: boolean;
  showR1: boolean;
  showR2: boolean;
  showR3: boolean;
  showR4: boolean;
}) {
  const par = fmtToPar(r.score_to_par);
  const rowKey = r.golfer_id ?? r.id;

  // Position label.
  // - Final view: use the row's own is_tie flag (set by ESPN) — the final
  //   position_numeric IS corrected for ties at settlement.
  // - R1/R2/R3 views: recomputed SCR position from roundPosMap (NOT the raw
  //   position_r{n} snapshot, which doesn't merge ties). tiedPositions is
  //   derived from the same map by the parent, so they always agree.
  let posLabel: string;
  if (round === "r4") {
    if (r.position_numeric === null) {
      posLabel = r.status_short_detail ?? r.position_display ?? "—";
    } else if (r.is_tie) {
      posLabel = `T${r.position_numeric}`;
    } else {
      posLabel = r.position_display ?? String(r.position_numeric);
    }
  } else {
    const v = roundPosMap?.get(rowKey) ?? null;
    if (v === null) {
      posLabel = "—";
    } else if (tiedPositions.has(v)) {
      posLabel = `T${v}`;
    } else {
      posLabel = String(v);
    }
  }

  // Δ movement: prevPos - currPos. Positive = climbed, negative = dropped.
  // Both sides come from the recomputed maps (R4's "curr" is the exception —
  // position_numeric is ESPN's final settled value, already tie-correct).
  let deltaCell: React.ReactNode = null;
  if (showDelta) {
    let prev: number | null = null;
    let curr: number | null = null;
    if (round === "r2" || round === "r3") {
      prev = prevRoundPosMap?.get(rowKey) ?? null;
      curr = roundPosMap?.get(rowKey) ?? null;
    } else if (round === "r4") {
      prev = prevRoundPosMap?.get(rowKey) ?? null;
      curr = r.position_numeric;
    }
    if (prev !== null && curr !== null) {
      const delta = prev - curr;
      if (delta === 0) {
        deltaCell = <span className="text-muted-foreground">—</span>;
      } else if (delta > 0) {
        deltaCell = <span className="text-green-600 font-semibold">↑{delta}</span>;
      } else {
        deltaCell = <span className="text-red-600 font-semibold">↓{-delta}</span>;
      }
    } else {
      deltaCell = <span className="text-muted-foreground">—</span>;
    }
  }

  const rowBg = mine ? "bg-amber-50" : "";
  const text = dim ? "text-muted-foreground" : "";
  return (
    <tr className={`${rowBg} ${text}`}>
      <td className="px-2 py-2 font-mono text-xs">{posLabel}</td>
      {showDelta && <td className="px-1 py-2 text-center font-mono text-xs">{deltaCell}</td>}
      <td className="px-2 py-2">
        <div className="font-medium leading-tight truncate">{r.espn_display_name}</div>
        {r.country && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{r.country}</div>
        )}
      </td>
      {showToPar && (
        <td className={`px-2 py-2 text-right font-mono ${par.cls}`}>{par.text}</td>
      )}
      {showR1 && <td className="px-1 py-2 text-right font-mono text-xs">{r.round_1 ?? "—"}</td>}
      {showR2 && <td className="px-1 py-2 text-right font-mono text-xs">{r.round_2 ?? "—"}</td>}
      {showR3 && <td className="px-1 py-2 text-right font-mono text-xs">{r.round_3 ?? "—"}</td>}
      {showR4 && <td className="px-1 pr-3 py-2 text-right font-mono text-xs">{r.round_4 ?? "—"}</td>}
    </tr>
  );
}

// =============================================================
// MAJOR7S VIEW
// =============================================================
type MajorView = "all" | "botr";

// Round-view scoring types (RoundTeamScore, RoundPickScore) and scoring
// functions (getInProgressRound, buildRoundPositionMap, computeRoundScores)
// now live in src/lib/major7s-round-scoring.ts — imported at the top of this
// file — so the Major7s view here and the admin end-of-round export always
// score identically. LbRow satisfies ScoringLbRow structurally (superset).

// -- Hook: fetch picks + teams and compute round scores --
function useMajor7sRoundScores(
  tournamentId: string,
  round: Round,
  lbRows: LbRow[],
) {
  // Picks for this tournament — paginated to avoid Supabase's 1000-row ceiling.
  // Masters 2026 has 183 teams × 7 picks = 1,281 rows, which silently truncates
  // without pagination, causing teams beyond row 1000 to show 0 points.
  const picksQuery = useQuery({
    queryKey: ["major7s-round-picks", tournamentId],
    queryFn: async () => {
      const PAGE = 1000;
      const all: { team_id: string; bucket: number; golfer_id: string }[] = [];
      for (let page = 0; page < 100; page++) {
        const from = page * PAGE;
        const { data, error } = await supabase
          .from("picks")
          .select("team_id, bucket, golfer_id")
          .eq("tournament_id", tournamentId)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const p of data) {
          all.push({
            team_id: p.team_id as string,
            bucket: p.bucket as number,
            golfer_id: p.golfer_id as string,
          });
        }
        if (data.length < PAGE) break;
      }
      return all;
    },
  });

  // Distinct teams from those picks — derive from picks + teams table
  const teamsQuery = useQuery({
    queryKey: ["major7s-round-teams", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_scores")
        .select("team_id, teams(id, nickname, owner_user_id)")
        .eq("tournament_id", tournamentId);
      if (error) throw error;
      return (data ?? [])
        .filter((r: any) => r.teams)
        .map((r: any) => ({
          id: r.teams.id as string,
          nickname: r.teams.nickname as string,
          owner_user_id: r.teams.owner_user_id as string,
        }));
    },
  });

  const scores = useMemo(() => {
    if (!teamsQuery.data || !picksQuery.data || lbRows.length === 0) return null;
    const current = computeRoundScores(teamsQuery.data, picksQuery.data, lbRows, round);

    // Compute delta: position change from previous round
    const prevRound: Round | null =
      round === "r1" ? null : round === "r2" ? "r1" : round === "r3" ? "r2" : "r3";
    if (prevRound) {
      const prev = computeRoundScores(teamsQuery.data, picksQuery.data, lbRows, prevRound);
      const prevMap = new Map(prev.map((s) => [s.team_id, s.position]));
      for (const team of current) {
        const pp = prevMap.get(team.team_id);
        team.delta = pp != null ? pp - team.position : null;
      }
    }

    return current;
  }, [teamsQuery.data, picksQuery.data, lbRows, round]);

  return {
    scores,
    isLoading: teamsQuery.isLoading || picksQuery.isLoading,
    error: teamsQuery.error || picksQuery.error,
  };
}

// -- Round-view pick breakdown (expandable) --
function RoundPickBreakdown({ picks, showDelta, round }: { picks: RoundPickScore[]; showDelta: boolean; round: Round }) {
  const roundCount = round === "r1" ? 1 : round === "r2" ? 2 : round === "r3" ? 3 : 4;
  const roundLabels = ["R1", "R2", "R3", "R4"].slice(0, roundCount);
  const sorted = [...picks].sort((a, b) => {
    if (a.counted !== b.counted) return a.counted ? -1 : 1;
    return a.points - b.points;
  });
  return (
    <div className="bg-muted/20 border-t border-border">
      <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "20px" }} />
          {showDelta && <col style={{ width: "20px" }} />}
          <col />
          {roundLabels.map((l) => (
            <col key={l} style={{ width: "48px" }} />
          ))}
          <col style={{ width: "20px" }} />
        </colgroup>
        <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th />
            {showDelta && <th />}
            <th />
            {roundLabels.map((label) => (
              <th key={label} className="text-center px-1 py-0.5">{label}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const lastPos = p.round_positions[p.round_positions.length - 1];
            const isNonFinisher = lastPos === null;
            const isDropped = !p.counted;
            let nameCls = "";
            let opacity = "";
            if (isNonFinisher) {
              nameCls = "text-red-600";
              if (isDropped) opacity = "opacity-30";
            } else if (isDropped) {
              nameCls = "text-muted-foreground";
              opacity = "opacity-60";
            }
            return (
              <tr key={p.golfer_id} className={opacity}>
                <td />
                {showDelta && <td />}
                <td className={`px-3 py-0.5 truncate ${nameCls}`}>{p.golfer_name}{p.status_label && <span className="ml-1 text-[10px] opacity-70">{p.status_label}</span>}</td>
                {p.round_positions.map((pos, i) => {
                  const isLastCol = i === p.round_positions.length - 1;
                  const isCarry = isLastCol && p.is_latest_carryforward;
                  const posNull = pos === null;
                  const cellCls = posNull
                    ? "text-red-600"
                    : isCarry
                      ? "text-muted-foreground"
                      : isDropped
                        ? "text-muted-foreground"
                        : "";
                  return (
                    <td key={i} className={`px-1 py-0.5 text-center font-mono text-[10px] ${cellCls}`}>
                      {posNull ? (p.status_label ? NON_FINISHER_POINTS : "—") : <span className={isCarry ? "italic" : ""}>{pos}</span>}
                    </td>
                  );
                })}
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -- Round-view expandable team row --
function RoundExpandableTeamRow({
  team, mine, medal, showDelta, round,
}: {
  team: RoundTeamScore;
  mine: boolean;
  medal: "gold" | "silver" | "bronze" | null;
  showDelta: boolean;
  round: Round;
}) {
  const [open, setOpen] = useState(false);
  const posDisplay = `${team.is_tie ? "T" : ""}${team.position}`;
  const rowBg = mine ? "bg-amber-50" : "";
  const cols = showDelta ? 6 : 5;
  return (
    <>
      <tr
        className={`${rowBg} cursor-pointer hover:bg-muted/30 transition-colors`}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-2 py-2 text-center">
          <div className="inline-flex justify-center">
            <PositionMedal positionDisplay={posDisplay} medal={medal} size="sm" />
          </div>
        </td>
        {showDelta && (
          <td className="px-1 py-2 text-center font-mono text-xs">
            <Major7sDeltaCell delta={team.delta} />
          </td>
        )}
        <td className="px-3 py-2 font-medium truncate">{team.nickname}</td>
        <td className="px-3 py-2 text-right font-mono font-semibold">{team.total}</td>
        <td className="px-2 py-2 text-center font-mono text-muted-foreground">
          {team.thru_cut !== null ? team.thru_cut : "—"}
        </td>
        <td className="px-2 py-2 text-muted-foreground">
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>

      <tr>
        <td colSpan={cols} className="p-0 border-0">
          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
              open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            {open && <RoundPickBreakdown picks={team.picks} showDelta={showDelta} round={round} />}
          </div>
        </td>
      </tr>
    </>
  );
}


// -- Round-view "Your Team" panel --
function RoundActiveTeamPanel({
  team, medal, showDelta, round,
}: { team: RoundTeamScore; medal: "gold" | "silver" | "bronze" | null; showDelta: boolean; round: Round }) {
  const [open, setOpen] = useState(false);
  const posDisplay = `${team.is_tie ? "T" : ""}${team.position}`;
  const cols = showDelta ? 6 : 5;
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-md overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800">
        Your Team
      </div>
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <MajorCols showDelta={showDelta} />
        <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-center px-3 py-1">Pos</th>
            {showDelta && <th className="text-center px-1 py-1">Δ</th>}
            <th />
            <th className="text-right px-3 py-1">Points</th>
            <th className="text-center px-3 py-1">{team.thru_cut !== null ? "Thru Cut" : ""}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            className="cursor-pointer hover:bg-amber-100/50 transition-colors"
            onClick={() => setOpen((o) => !o)}
          >
            <td className="px-3 py-2 text-center">
              <div className="inline-flex justify-center">
                <PositionMedal positionDisplay={posDisplay} medal={medal} size="sm" />
              </div>
            </td>
            {showDelta && (
              <td className="px-1 py-2 text-center font-mono text-xs">
                <Major7sDeltaCell delta={team.delta} />
              </td>
            )}
            <td className="px-3 py-2 font-medium truncate">{team.nickname}</td>
            <td className="px-3 py-2 text-right font-mono font-semibold">{team.total}</td>
            <td className="px-3 py-2 text-center font-mono text-muted-foreground">
              {team.thru_cut !== null ? team.thru_cut : ""}
            </td>
            <td className="px-3 py-2 text-muted-foreground">
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            </td>
          </tr>
          <tr>
            <td colSpan={cols} className="p-0 border-0">
              <div
                className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
                  open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                {open && (
                  <div className="bg-amber-50/50">
                    <RoundPickBreakdown picks={team.picks} showDelta={showDelta} round={round} />
                  </div>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// -- Main MajorSevensTable (round-aware, on-the-fly scoring for all rounds) --
function MajorSevensTable({
  tournamentId, myTeamId, round, lbRows,
}: {
  tournamentId: string;
  myTeamId: string | null;
  round: Round;
  lbRows: LbRow[];
}) {
  const [mode, setMode] = useState<MajorView>("all");

  // Silently reset BOTR when switching to R1/R2
  const botrAvailable = round === "r3" || round === "r4";
  useEffect(() => {
    if (!botrAvailable) setMode("all");
  }, [botrAvailable]);

  // On-the-fly computation for all rounds (R1–R4)
  const { scores: roundScores, isLoading: roundLoading, error: roundError } = useMajor7sRoundScores(
    tournamentId,
    round,
    lbRows,
  );

  // Δ column: shown on R2, R3, and R4 (not R1 — no prior round to compare)
  const showDelta = round !== "r1";

  if (roundLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (roundError) {
    return (
      <div className="border-2 border-dashed border-red-300 p-12 text-center bg-red-50/30">
        <p className="font-display text-sm uppercase mb-2">Major7s Scoring</p>
        <p className="text-sm text-red-600">
          Failed to load round data: {(roundError as Error).message}
        </p>
      </div>
    );
  }
  if (!roundScores || roundScores.length === 0) {
    return (
      <div className="border-2 border-dashed border-border p-12 text-center bg-card/30">
        <p className="font-display text-sm uppercase mb-2">Major7s Scoring</p>
        <p className="text-sm text-muted-foreground">
          No scoring data for this round yet.
        </p>
      </div>
    );
  }

  // BOTR filter (R3 and R4)
  const visibleTeams =
    mode === "botr" && botrAvailable
      ? roundScores.filter((t) => t.thru_cut !== null && t.thru_cut < 5)
      : roundScores;

  const myTeam = myTeamId
    ? visibleTeams.find((t) => t.owner_user_id === myTeamId || t.team_id === myTeamId) ?? null
    : null;
  const allMyTeam = myTeamId
    ? roundScores.find((t) => t.owner_user_id === myTeamId || t.team_id === myTeamId) ?? null
    : null;
  const myTeamDisqualifiedFromBotr = mode === "botr" && !!allMyTeam && !myTeam;

  // Thru Cut column header: show on R3 and R4 (post-cut rounds)
  const showThruCut = round === "r3" || round === "r4";

  // Medal overlay: podium positions in R4 only when the round is complete
  const r4Complete =
    round === "r4" &&
    getInProgressRound(lbRows) === null &&
    lbRows.some((r) => r.round_4 != null);

  const medalForPosition = (pos: number): "gold" | "silver" | "bronze" | null => {
    if (!r4Complete) return null;
    if (pos === 1) return "gold";
    if (pos === 2) return "silver";
    if (pos === 3) return "bronze";
    return null;
  };

  return (
    <div className="space-y-3">
      {/* ALL / BOTR toggle — R3 and R4 */}
      {botrAvailable && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-md border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => setMode("all")}
              className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded ${
                mode === "all" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setMode("botr")}
              className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded ${
                mode === "botr" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Best of the Rest — teams with fewer than 5 picks through the cut"
            >
              BOTR
            </button>
          </div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {visibleTeams.length} {visibleTeams.length === 1 ? "team" : "teams"}
          </div>
        </div>
      )}

      {/* Team count when BOTR not shown (R1/R2) */}
      {!botrAvailable && (
        <div className="flex justify-end">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {visibleTeams.length} {visibleTeams.length === 1 ? "team" : "teams"}
          </div>
        </div>
      )}

      {myTeam && (
        <RoundActiveTeamPanel team={myTeam} medal={medalForPosition(myTeam.position)} showDelta={showDelta} round={round} />
      )}
      {myTeamDisqualifiedFromBotr && (
        <div className="border border-dashed border-border bg-card/50 rounded-md px-3 py-2 text-xs text-muted-foreground italic">
          Your team has 5+ picks through the cut and isn't in this competition.
        </div>
      )}

      <div className="border border-border bg-card">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <MajorCols showDelta={showDelta} />
          <thead className="sticky top-16 z-10 bg-card text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border shadow-sm">
            <tr>
              <th className="text-center px-3 py-2">Pos</th>
              {showDelta && <th className="text-center px-1 py-2" title="Position change from previous round">Δ</th>}
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-right px-3 py-2">Points</th>
              <th className="text-center px-3 py-2">{showThruCut ? "Thru Cut" : ""}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleTeams.length === 0 ? (
              <tr>
                <td colSpan={showDelta ? 6 : 5} className="px-3 py-6 text-center text-xs text-muted-foreground italic">
                  No teams in this competition yet.
                </td>
              </tr>
            ) : (
              visibleTeams.map((t) => (
                <RoundExpandableTeamRow
                  key={t.team_id}
                  team={t}
                  mine={!!myTeamId && (t.team_id === myTeamId || t.owner_user_id === myTeamId)}
                  medal={medalForPosition(t.position)}
                  showDelta={showDelta}
                  round={round}
                />
              ))
            )}
          </tbody>
        </table>
      </div>


    </div>
  );
}

function PositionMedal({
  positionDisplay, medal, size = "sm",
}: { positionDisplay: string; medal: "gold" | "silver" | "bronze" | null; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "w-12 h-12 text-base" : "w-9 h-9 text-xs";
  if (!medal) {
    return <span className="font-mono text-xs">{positionDisplay}</span>;
  }
  const styles: Record<string, React.CSSProperties> = {
    gold: {
      background: "radial-gradient(circle at 30% 30%, #fff7c2 0%, #f5c441 35%, #b8860b 100%)",
      color: "#3a2a00",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.25)",
    },
    silver: {
      background: "radial-gradient(circle at 30% 30%, #ffffff 0%, #d3d3d3 35%, #7d7d7d 100%)",
      color: "#222",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.25)",
    },
    bronze: {
      background: "radial-gradient(circle at 30% 30%, #fadcb6 0%, #c98447 35%, #6b3a1a 100%)",
      color: "#2a1500",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.25)",
    },
  };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold leading-none ${dim}`}
      style={styles[medal]}
    >
      {positionDisplay}
    </span>
  );
}


