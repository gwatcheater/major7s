import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonation } from "@/context/impersonation-context";
import { useTeams } from "@/hooks/use-teams";

// VERSION MARKER: leaderboard v4.3 — Major7s round-by-round on-the-fly scoring + BOTR gating
// If you see this comment in the deployed bundle, you're on the right version.

export const Route = createFileRoute("/_authenticated/tournament/$id/leaderboard")({
  component: LeaderboardView,
});

type View = "tournament" | "major7s";
// "current" is a label shown on the toggle when the tournament is live;
// internally it behaves identically to "final" (use position_numeric).
type Round = "r1" | "r2" | "r3" | "final";

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

interface ScoreRow {
  id: string;
  team_id: string;
  total_points: number;
  thru_cut: number;
  position_display: string;
  position_numeric: number;
  teams: { nickname: string; owner_user_id: string } | null;
}

interface ScorePickRow {
  bucket: number;
  golfer_name: string;
  points: number;
  status_type: string | null;
  counted: boolean;
}

const NON_FINISHER_POINTS = 100;

function isCutOrWithdrawn(status: string | null) {
  return status === "STATUS_CUT" || status === "STATUS_WITHDRAWN";
}

function fmtToPar(v: number | null): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: "—", cls: "text-muted-foreground" };
  if (v === 0) return { text: "E", cls: "text-foreground" };
  if (v < 0) return { text: String(v), cls: "text-red-600 font-semibold" };
  return { text: `+${v}`, cls: "text-foreground" };
}

// Shared column widths for ALL Major7s tables (panel, leaderboard, breakdown).
// Identical widths + tableLayout:fixed guarantee column alignment across them.
function MajorCols() {
  return (
    <colgroup>
      <col style={{ width: "52px" }} />
      <col />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "32px" }} />
    </colgroup>
  );
}

function LeaderboardView() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const { activeTeam } = useTeams();
  const effectiveUserId = getEffectiveUserId(user?.id);
  const [view, setView] = useState<View>("major7s");
  // Round selector — defaults to "final" (the tournament's settled view).
  // Shared across both Major7s and Tournament views so switching views
  // doesn't reset the user's round selection.
  const [round, setRound] = useState<Round>("final");

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

  // Whether this tournament has per-round position data. Older tournaments
  // (PGA 2021/2023/2024, Masters 2024) lack ESPN's `currentPosition` in
  // linescores, so position_r1..r3 are null. In that case the round toggle
  // is hidden and only Final view is shown.
  const hasRoundData = useMemo(
    () => rows.some((r) => r.position_r1 !== null),
    [rows],
  );

  // Round-aware grouping + sorting of leaderboard rows.
  const { active, cut } = useMemo(() => {
    // Final view: existing behaviour (CUT/WD in their own bottom group).
    if (round === "final") {
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

    // Round view (r1 / r2 / r3): filter to rows with that round's position
    // populated, sort by it. No "cut" bucket — players outside this set
    // simply hadn't played this round (or had already left the field).
    const roundKey = round === "r1" ? "position_r1"
                  : round === "r2" ? "position_r2"
                  : "position_r3";
    const a: LbRow[] = [];
    for (const r of rows) {
      if (r[roundKey] !== null) a.push(r);
    }
    a.sort((x, y) => {
      const xp = (x[roundKey] ?? 9999) as number;
      const yp = (y[roundKey] ?? 9999) as number;
      if (xp !== yp) return xp - yp;
      return x.espn_display_name.localeCompare(y.espn_display_name);
    });
    return { active: a, cut: [] };
  }, [rows, round]);

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
            has no per-round data (older ESPN archives). The "Final" label
            becomes "Current" for live tournaments. */}
        {hasRoundData && (view === "tournament" || view === "major7s") && (
          <RoundToggle
            round={round}
            onChange={setRound}
            finalLabel={tournament?.status === "live" ? "Current" : "Final"}
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
        <TournamentTable active={active} cut={cut} myPickGolferIds={myPickGolferIds} round={round} />
      )}
    </div>
  );
}

// =============================================================
// ROUND TOGGLE
// =============================================================
function RoundToggle({
  round, onChange, finalLabel,
}: {
  round: Round;
  onChange: (r: Round) => void;
  finalLabel: string;
}) {
  const items: { value: Round; label: string }[] = [
    { value: "r1", label: "R1" },
    { value: "r2", label: "R2" },
    { value: "r3", label: "R3" },
    { value: "final", label: finalLabel },
  ];
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
  active, cut, myPickGolferIds, round,
}: {
  active: LbRow[];
  cut: LbRow[];
  myPickGolferIds: Set<string>;
  round: Round;
}) {
  const showR1 = true;
  const showR2 = round === "r2" || round === "r3" || round === "final";
  const showR3 = round === "r3" || round === "final";
  const showR4 = round === "final";
  const showToPar = round === "final";
  // Δ = movement from previous round. R1 has no prior round to compare to.
  const showDelta = round !== "r1";

  // Tie detection for round views. Final view uses the row's `is_tie` flag
  // directly (computed by ESPN). For r1/r2/r3 we have no flag, so derive it
  // by counting how many rows share the same position_r{n} value across the
  // full active+cut list. Built once per round-switch, O(N).
  const tiedPositions = useMemo<Set<number>>(() => {
    if (round === "final") return new Set();
    const posKey: "position_r1" | "position_r2" | "position_r3" =
      round === "r1" ? "position_r1" : round === "r2" ? "position_r2" : "position_r3";
    const counts = new Map<number, number>();
    for (const r of active) {
      const v = r[posKey];
      if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const ties = new Set<number>();
    for (const [pos, count] of counts) {
      if (count > 1) ties.add(pos);
    }
    return ties;
  }, [active, round]);

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
  r, mine, dim, round, tiedPositions, showDelta, showToPar, showR1, showR2, showR3, showR4,
}: {
  r: LbRow;
  mine: boolean;
  dim?: boolean;
  round: Round;
  tiedPositions: Set<number>;
  showDelta: boolean;
  showToPar: boolean;
  showR1: boolean;
  showR2: boolean;
  showR3: boolean;
  showR4: boolean;
}) {
  const par = fmtToPar(r.score_to_par);

  // Position label.
  // - Final view: use the row's own is_tie flag (set by ESPN).
  // - R1/R2/R3 views: tied iff this row's position_r{n} appears more than
  //   once across the table (tiedPositions set, built once by the parent).
  let posLabel: string;
  if (round === "final") {
    if (r.position_numeric === null) {
      posLabel = r.status_short_detail ?? r.position_display ?? "—";
    } else if (r.is_tie) {
      posLabel = `T${r.position_numeric}`;
    } else {
      posLabel = r.position_display ?? String(r.position_numeric);
    }
  } else {
    const posKey = round === "r1" ? "position_r1"
                : round === "r2" ? "position_r2"
                : "position_r3";
    const v = r[posKey];
    if (v === null) {
      posLabel = "—";
    } else if (tiedPositions.has(v)) {
      posLabel = `T${v}`;
    } else {
      posLabel = String(v);
    }
  }

  // Δ movement: prevPos - currPos. Positive = climbed, negative = dropped.
  let deltaCell: React.ReactNode = null;
  if (showDelta) {
    let prev: number | null = null;
    let curr: number | null = null;
    if (round === "r2") {
      prev = r.position_r1;
      curr = r.position_r2;
    } else if (round === "r3") {
      prev = r.position_r2;
      curr = r.position_r3;
    } else if (round === "final") {
      prev = r.position_r3;
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
function medalFor(positionNumeric: number): "gold" | "silver" | "bronze" | null {
  if (positionNumeric === 1) return "gold";
  if (positionNumeric === 2) return "silver";
  if (positionNumeric === 3) return "bronze";
  return null;
}

type MajorView = "all" | "botr";

// -- Round-view scoring types --
interface RoundTeamScore {
  team_id: string;
  nickname: string;
  owner_user_id: string;
  total: number;
  position: number;
  is_tie: boolean;
  picks: RoundPickScore[];
  thru_cut: number | null; // null on R1/R2 (meaningless pre-cut)
}

interface RoundPickScore {
  golfer_id: string;
  golfer_name: string;
  bucket: number;
  position_in_round: number | null;
  points: number;
  counted: boolean;
}

// -- Round-view scoring computation --
function positionKeyForRound(round: Round): "position_r1" | "position_r2" | "position_r3" | "position_numeric" {
  const map: Record<Round, "position_r1" | "position_r2" | "position_r3" | "position_numeric"> = {
    r1: "position_r1",
    r2: "position_r2",
    r3: "position_r3",
    final: "position_numeric",
  };
  return map[round];
}

/**
 * Compute Major7s team scores on the fly for a non-final round.
 * Each pick scores its position_r{n} value (lower = better). Null = 100.
 * Best 5 of 7 count. Standard Competition Ranking for ties.
 */
function computeRoundScores(
  teams: { id: string; nickname: string; owner_user_id: string }[],
  picks: { team_id: string; bucket: number; golfer_id: string; golfer_name: string }[],
  lbRows: LbRow[],
  round: Exclude<Round, "final">,
): RoundTeamScore[] {
  const posKey = positionKeyForRound(round);
  const lbByGolfer = new Map<string, LbRow>();
  for (const row of lbRows) {
    if (row.golfer_id) lbByGolfer.set(row.golfer_id, row);
  }

  const scored: RoundTeamScore[] = teams.map((team) => {
    const teamPicks = picks.filter((p) => p.team_id === team.id);
    const pickScores: RoundPickScore[] = teamPicks.map((pick) => {
      const lb = lbByGolfer.get(pick.golfer_id);
      const posVal = lb ? (lb[posKey] as number | null) : null;
      return {
        golfer_id: pick.golfer_id,
        golfer_name: pick.golfer_name || lb?.espn_display_name || "Unknown",
        bucket: pick.bucket,
        position_in_round: posVal,
        points: posVal ?? NON_FINISHER_POINTS,
        counted: false,
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

    // thru_cut only meaningful on R3
    let thruCut: number | null = null;
    if (round === "r3") {
      thruCut = pickScores.filter((p) => p.position_in_round !== null).length;
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

// -- Hook: fetch picks + teams and compute round scores --
function useMajor7sRoundScores(
  tournamentId: string,
  round: Exclude<Round, "final">,
  lbRows: LbRow[],
) {
  // Picks for this tournament — includes golfer_name for display
  const picksQuery = useQuery({
    queryKey: ["major7s-round-picks", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks")
        .select("team_id, bucket, golfer_id, golfers(name)")
        .eq("tournament_id", tournamentId);
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        team_id: p.team_id as string,
        bucket: p.bucket as number,
        golfer_id: p.golfer_id as string,
        golfer_name: (p.golfers?.name ?? "") as string,
      }));
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
    return computeRoundScores(teamsQuery.data, picksQuery.data, lbRows, round);
  }, [teamsQuery.data, picksQuery.data, lbRows, round]);

  return {
    scores,
    isLoading: teamsQuery.isLoading || picksQuery.isLoading,
    error: teamsQuery.error || picksQuery.error,
  };
}

// -- Round-view pick breakdown (expandable) --
function RoundPickBreakdown({ picks }: { picks: RoundPickScore[] }) {
  const sorted = [...picks].sort((a, b) => {
    if (a.counted !== b.counted) return a.counted ? -1 : 1;
    return a.points - b.points;
  });
  return (
    <div className="bg-muted/20 border-t border-border">
      <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
        <MajorCols />
        <tbody>
          {sorted.map((p) => {
            const isNonFinisher = p.position_in_round === null;
            const isDropped = !p.counted;
            let nameCls = "";
            let ptsCls = "font-mono font-semibold";
            let opacity = "";
            if (isNonFinisher) {
              nameCls = "text-red-600";
              ptsCls = "font-mono font-semibold text-red-600";
              if (isDropped) opacity = "opacity-30";
            } else if (isDropped) {
              nameCls = "text-muted-foreground";
              ptsCls = "font-mono font-semibold text-muted-foreground";
              opacity = "opacity-60";
            }
            return (
              <tr key={p.golfer_id} className={opacity}>
                <td />
                <td className={`px-3 py-0.5 truncate ${nameCls}`}>{p.golfer_name}</td>
                <td className={`px-3 py-0.5 text-right ${ptsCls}`}>{p.points}</td>
                <td className="px-2 py-0.5 text-center font-mono text-muted-foreground text-[10px]">
                  {isNonFinisher ? "—" : p.position_in_round}
                </td>
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
  team, mine, medal,
}: {
  team: RoundTeamScore;
  mine: boolean;
  medal: "gold" | "silver" | "bronze" | null;
}) {
  const [open, setOpen] = useState(false);
  const posDisplay = `${team.is_tie ? "T" : ""}${team.position}`;
  const rowBg = mine ? "bg-amber-50" : "";
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
        <td colSpan={5} className="p-0 border-0">
          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
              open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            {open && <RoundPickBreakdown picks={team.picks} />}
          </div>
        </td>
      </tr>
    </>
  );
}

// -- Round-view "Your Team" panel --
function RoundActiveTeamPanel({
  team, medal,
}: { team: RoundTeamScore; medal: "gold" | "silver" | "bronze" | null }) {
  const [open, setOpen] = useState(false);
  const posDisplay = `${team.is_tie ? "T" : ""}${team.position}`;
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-md overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800">
        Your Team
      </div>
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <MajorCols />
        <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-center px-3 py-1">Pos</th>
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
            <td colSpan={5} className="p-0 border-0">
              <div
                className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
                  open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                {open && (
                  <div className="bg-amber-50/50 border-t border-border">
                    <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
                      <MajorCols />
                      <tbody>
                        {[...team.picks]
                          .sort((a, b) => {
                            if (a.counted !== b.counted) return a.counted ? -1 : 1;
                            return a.points - b.points;
                          })
                          .map((p) => {
                            const isNonFinisher = p.position_in_round === null;
                            const isDropped = !p.counted;
                            let nameCls = "";
                            let ptsCls = "font-mono font-semibold";
                            let opacity = "";
                            if (isNonFinisher) {
                              nameCls = "text-red-600";
                              ptsCls = "font-mono font-semibold text-red-600";
                              if (isDropped) opacity = "opacity-30";
                            } else if (isDropped) {
                              nameCls = "text-muted-foreground";
                              ptsCls = "font-mono font-semibold text-muted-foreground";
                              opacity = "opacity-60";
                            }
                            return (
                              <tr key={p.golfer_id} className={opacity}>
                                <td />
                                <td className={`px-3 py-0.5 truncate ${nameCls}`}>{p.golfer_name}</td>
                                <td className={`px-3 py-0.5 text-right ${ptsCls}`}>{p.points}</td>
                                <td className="px-2 py-0.5 text-center font-mono text-muted-foreground text-[10px]">
                                  {isNonFinisher ? "—" : p.position_in_round}
                                </td>
                                <td />
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
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

// -- Main MajorSevensTable (now round-aware) --
function MajorSevensTable({
  tournamentId, myTeamId, round, lbRows,
}: {
  tournamentId: string;
  myTeamId: string | null;
  round: Round;
  lbRows: LbRow[];
}) {
  const [mode, setMode] = useState<MajorView>("all");

  // 3d: Silently reset BOTR when switching to R1/R2
  const botrAvailable = round === "r3" || round === "final";
  useEffect(() => {
    if (!botrAvailable) setMode("all");
  }, [botrAvailable]);

  // -- Final view: persisted tournament_scores (existing behaviour) --
  const { data: finalRows = [], isLoading: finalLoading } = useQuery({
    queryKey: ["tournament-scores", tournamentId],
    enabled: round === "final",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_scores")
        .select("id, team_id, total_points, thru_cut, position_display, position_numeric, teams(nickname, owner_user_id)")
        .eq("tournament_id", tournamentId)
        .order("position_numeric", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ScoreRow[];
    },
  });

  // -- Round view: on-the-fly computation --
  const { scores: roundScores, isLoading: roundLoading } = useMajor7sRoundScores(
    tournamentId,
    round === "final" ? "r1" : round, // dummy when final; hook won't run
    lbRows,
  );

  // ---- ROUND VIEW (R1 / R2 / R3) ----
  if (round !== "final") {
    if (roundLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
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

    // BOTR filter on R3 only (R1/R2 already gated away by botrAvailable)
    const visibleTeams =
      mode === "botr" && round === "r3"
        ? roundScores.filter((t) => t.thru_cut !== null && t.thru_cut < 5)
        : roundScores;

    const myTeam = myTeamId
      ? visibleTeams.find((t) => t.owner_user_id === myTeamId || t.team_id === myTeamId) ?? null
      : null;
    const allMyTeam = myTeamId
      ? roundScores.find((t) => t.owner_user_id === myTeamId || t.team_id === myTeamId) ?? null
      : null;
    const myTeamDisqualifiedFromBotr = mode === "botr" && !!allMyTeam && !myTeam;

    // Thru Cut column header: show on R3 only
    const showThruCut = round === "r3";

    return (
      <div className="space-y-3">
        {/* ALL / BOTR toggle — R3 only */}
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
          <RoundActiveTeamPanel team={myTeam} medal={medalFor(myTeam.position)} />
        )}
        {myTeamDisqualifiedFromBotr && (
          <div className="border border-dashed border-border bg-card/50 rounded-md px-3 py-2 text-xs text-muted-foreground italic">
            Your team has 5+ picks through the cut and isn't in this competition.
          </div>
        )}

        <div className="border border-border bg-card">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <MajorCols />
            <thead className="sticky top-16 z-10 bg-card text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border shadow-sm">
              <tr>
                <th className="text-center px-3 py-2">Pos</th>
                <th className="text-left px-3 py-2">Team</th>
                <th className="text-right px-3 py-2">Points</th>
                <th className="text-center px-3 py-2">{showThruCut ? "Thru Cut" : ""}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleTeams.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground italic">
                    No teams in this competition yet.
                  </td>
                </tr>
              ) : (
                visibleTeams.map((t) => (
                  <RoundExpandableTeamRow
                    key={t.team_id}
                    team={t}
                    mine={!!myTeamId && (t.team_id === myTeamId || t.owner_user_id === myTeamId)}
                    medal={medalFor(t.position)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ---- FINAL VIEW (persisted tournament_scores — unchanged behaviour) ----
  if (finalLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (finalRows.length === 0) {
    return (
      <div className="border-2 border-dashed border-border p-12 text-center bg-card/30">
        <p className="font-display text-sm uppercase mb-2">Major7s Scoring</p>
        <p className="text-sm text-muted-foreground">
          Major7s scoring will appear here once results are tallied.
        </p>
      </div>
    );
  }

  const visibleRows = mode === "botr" ? finalRows.filter((r) => r.thru_cut < 5) : finalRows;
  const myRow = myTeamId ? visibleRows.find((r) => r.team_id === myTeamId) ?? null : null;
  const allMyRow = myTeamId ? finalRows.find((r) => r.team_id === myTeamId) ?? null : null;
  const myTeamDisqualifiedFromBotr = mode === "botr" && !!allMyRow && !myRow;

  return (
    <div className="space-y-3">
      {/* ALL / BOTR mode toggle */}
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
          {visibleRows.length} {visibleRows.length === 1 ? "team" : "teams"}
        </div>
      </div>

      {myRow && (
        <ActiveTeamPanel row={myRow} medal={medalFor(myRow.position_numeric)} />
      )}
      {myTeamDisqualifiedFromBotr && (
        <div className="border border-dashed border-border bg-card/50 rounded-md px-3 py-2 text-xs text-muted-foreground italic">
          Your team has 5+ picks through the cut and isn't in this competition.
        </div>
      )}

      <div className="border border-border bg-card">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <MajorCols />
          <thead className="sticky top-16 z-10 bg-card text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border shadow-sm">
            <tr>
              <th className="text-center px-3 py-2">Pos</th>
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-right px-3 py-2">Points</th>
              <th className="text-center px-3 py-2">Thru Cut</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground italic">
                  No teams in this competition yet.
                </td>
              </tr>
            ) : (
              visibleRows.map((r) => (
                <ExpandableTeamRow
                  key={r.id}
                  r={r}
                  mine={!!myTeamId && r.team_id === myTeamId}
                  medal={medalFor(r.position_numeric)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActiveTeamPanel({
  row, medal,
}: { row: ScoreRow; medal: "gold" | "silver" | "bronze" | null }) {
  const [open, setOpen] = useState(false);
  const { data: picks, isLoading: picksLoading } = useQuery({
    queryKey: ["tournament-score-picks", row.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_score_picks")
        .select("bucket, golfer_name, points, status_type, counted")
        .eq("tournament_score_id", row.id)
        .order("bucket", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScorePickRow[];
    },
  });

  return (
    <div className="border border-amber-300 bg-amber-50 rounded-md overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800">
        Your Team
      </div>
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <MajorCols />
        <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-center px-3 py-1">Pos</th>
            <th />
            <th className="text-right px-3 py-1">Points</th>
            <th className="text-center px-3 py-1">Thru Cut</th>
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
                <PositionMedal positionDisplay={row.position_display} medal={medal} size="sm" />
              </div>
            </td>
            <td className="px-3 py-2 font-medium truncate">{row.teams?.nickname ?? "—"}</td>
            <td className="px-3 py-2 text-right font-mono font-semibold">{row.total_points}</td>
            <td className="px-3 py-2 text-center font-mono text-muted-foreground">{row.thru_cut}</td>
            <td className="px-3 py-2 text-muted-foreground">
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            </td>
          </tr>
          <tr>
            <td colSpan={5} className="p-0 border-0">
              <div
                className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
                  open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <PickBreakdown picks={picks ?? null} loading={picksLoading} mine={true} />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
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

function ExpandableTeamRow({
  r, mine, medal,
}: { r: ScoreRow; mine: boolean; medal: "gold" | "silver" | "bronze" | null }) {
  const [open, setOpen] = useState(false);
  const { data: picks, isLoading: picksLoading } = useQuery({
    queryKey: ["tournament-score-picks", r.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_score_picks")
        .select("bucket, golfer_name, points, status_type, counted")
        .eq("tournament_score_id", r.id)
        .order("bucket", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScorePickRow[];
    },
  });
  const rowBg = mine ? "bg-amber-50" : "";
  return (
    <>
      <tr
        className={`${rowBg} cursor-pointer hover:bg-muted/30 transition-colors`}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-2 py-2 text-center">
          <div className="inline-flex justify-center">
            <PositionMedal positionDisplay={r.position_display} medal={medal} size="sm" />
          </div>
        </td>
        <td className="px-3 py-2 font-medium truncate">{r.teams?.nickname ?? "—"}</td>
        <td className="px-3 py-2 text-right font-mono font-semibold">{r.total_points}</td>
        <td className="px-2 py-2 text-center font-mono text-muted-foreground">{r.thru_cut}</td>
        <td className="px-2 py-2 text-muted-foreground">
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>
      <tr>
        <td colSpan={5} className="p-0 border-0">
          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
              open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <PickBreakdown picks={picks ?? null} loading={picksLoading} mine={mine} />
          </div>
        </td>
      </tr>
    </>
  );
}

function PickBreakdown({
  picks, loading, mine,
}: { picks: ScorePickRow[] | null; loading: boolean; mine: boolean }) {
  if (loading) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">Loading picks…</div>;
  }
  if (!picks || picks.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">No picks recorded.</div>;
  }
  return (
    <div className={`${mine ? "bg-amber-50/50" : "bg-muted/20"} border-t border-border`}>
      <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
        <MajorCols />
        <tbody>
          {picks.map((p) => {
            const cutLike = p.points === NON_FINISHER_POINTS;
            let nameCls = "";
            let pointsCls = "font-mono font-semibold";
            let opacity = "";
            if (cutLike) {
              nameCls = "text-red-600";
              pointsCls = "font-mono font-semibold text-red-600";
              if (!p.counted) opacity = "opacity-30";
            } else if (!p.counted) {
              nameCls = "text-muted-foreground";
              pointsCls = "font-mono font-semibold text-muted-foreground";
              opacity = "opacity-60";
            }
            return (
              <tr key={p.bucket} className={opacity}>
                <td />
                <td className={`px-3 py-0.5 truncate ${nameCls}`}>{p.golfer_name}</td>
                <td className={`px-3 py-0.5 text-right ${pointsCls}`}>{p.points}</td>
                <td />
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
