import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Star, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonation } from "@/context/impersonation-context";
import { useTeams } from "@/hooks/use-teams";

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
  total_strokes: number | null;
  score_to_par: number | null;
  round_1: number | null;
  round_2: number | null;
  round_3: number | null;
  round_4: number | null;
}

function isCutOrWithdrawn(status: string | null) {
  return status === "STATUS_CUT" || status === "STATUS_WITHDRAWN";
}

function fmtToPar(v: number | null): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: "—", cls: "text-muted-foreground" };
  if (v === 0) return { text: "E", cls: "text-foreground" };
  if (v < 0) return { text: String(v), cls: "text-red-600 font-semibold" };
  return { text: `+${v}`, cls: "text-foreground" };
}

function LeaderboardView() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const { activeTeam } = useTeams();
  const effectiveUserId = getEffectiveUserId(user?.id);
  const [view, setView] = useState<View>("major7s");

  const { data: tournament } = useQuery({
    queryKey: ["tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments").select("id, name, location").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["tournament-leaderboard", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_leaderboard")
        .select("id, golfer_id, espn_display_name, country, position_display, position_numeric, is_tie, status_type, total_strokes, score_to_par, round_1, round_2, round_3, round_4")
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

  const { active, cut } = useMemo(() => {
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
  }, [rows]);

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

      <div className="inline-flex rounded-md border border-border bg-card p-1 mb-6">
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

      {view === "major7s" ? (
        <MajorSevensTable tournamentId={id} myTeamId={activeTeam?.id ?? null} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground p-4">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground p-4">
          No leaderboard data yet. An admin can import the final results from the tournament admin page.
        </p>
      ) : (
        <TournamentTable active={active} cut={cut} myPickGolferIds={myPickGolferIds} />
      )}
    </div>
  );
}

/* ============================================================
   TOURNAMENT VIEW (ESPN leaderboard)
   ============================================================ */
function TournamentTable({
  active, cut, myPickGolferIds,
}: { active: LbRow[]; cut: LbRow[]; myPickGolferIds: Set<string> }) {
  return (
    <div className="border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 w-16">Pos</th>
            <th className="text-left px-3 py-2">Golfer</th>
            <th className="text-right px-3 py-2 w-20">To Par</th>
            <th className="text-right px-3 py-2 w-16">Tot</th>
            <th className="text-right px-2 py-2 w-10">R1</th>
            <th className="text-right px-2 py-2 w-10">R2</th>
            <th className="text-right px-2 py-2 w-10">R3</th>
            <th className="text-right px-2 py-2 w-10">R4</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {active.map((r) => (
            <TourneyRow key={r.id} r={r} mine={!!r.golfer_id && myPickGolferIds.has(r.golfer_id)} />
          ))}
          {cut.length > 0 && (
            <>
              <tr className="bg-muted/30">
                <td colSpan={8} className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                  Missed Cut / Withdrew
                </td>
              </tr>
              {cut.map((r) => (
                <TourneyRow key={r.id} r={r} mine={!!r.golfer_id && myPickGolferIds.has(r.golfer_id)} dim />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TourneyRow({ r, mine, dim }: { r: LbRow; mine: boolean; dim?: boolean }) {
  const par = fmtToPar(r.score_to_par);
  const pos = r.position_display ?? "—";
  const posLabel = r.is_tie && r.position_numeric !== null ? `T${r.position_numeric}` : pos;
  const rowBg = mine ? "bg-amber-50" : "";
  const text = dim ? "text-muted-foreground" : "";
  return (
    <tr className={`${rowBg} ${text}`}>
      <td className="px-3 py-2 font-mono text-xs">
        <span className="inline-flex items-center gap-1">
          {mine && <Star className="w-3 h-3 fill-amber-500 text-amber-500" />}
          {posLabel}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="font-medium leading-tight">{r.espn_display_name}</div>
        {r.country && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.country}</div>
        )}
      </td>
      <td className={`px-3 py-2 text-right font-mono ${par.cls}`}>{par.text}</td>
      <td className="px-3 py-2 text-right font-mono">{r.total_strokes ?? "—"}</td>
      <td className="px-2 py-2 text-right font-mono text-xs">{r.round_1 ?? "—"}</td>
      <td className="px-2 py-2 text-right font-mono text-xs">{r.round_2 ?? "—"}</td>
      <td className="px-2 py-2 text-right font-mono text-xs">{r.round_3 ?? "—"}</td>
      <td className="px-2 py-2 text-right font-mono text-xs">{r.round_4 ?? "—"}</td>
    </tr>
  );
}

/* ============================================================
   MAJOR7S VIEW (computed picks-game scores)
   ============================================================ */
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

/**
 * Shared <colgroup> for all three tables (active-team panel, main leaderboard,
 * expanded breakdown). Identical widths ensure values line up column-for-column
 * regardless of cell content. Browser tables auto-size columns to content
 * unless told otherwise, so without this colgroup the medal cell pushes other
 * columns around.
 */
function MajorCols() {
  return (
    <colgroup>
      <col style={{ width: "72px" }} />  {/* Pos / Bucket */}
      <col />                            {/* Team / Golfer name (flex) */}
      <col style={{ width: "96px" }} />  {/* Points */}
      <col style={{ width: "96px" }} />  {/* Thru Cut */}
      <col style={{ width: "40px" }} />  {/* Chevron */}
    </colgroup>
  );
}

function MajorSevensTable({ tournamentId, myTeamId }: { tournamentId: string; myTeamId: string | null }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["tournament-scores", tournamentId],
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

  // Standard Competition Ranking: medals follow the numeric position directly.
  // T1/T1 -> both gold, next team is at numeric 3 -> bronze (no silver).
  // T2/T2 -> both silver, next team is at numeric 4 -> no bronze.
  function medalFor(positionNumeric: number): "gold" | "silver" | "bronze" | null {
    if (positionNumeric === 1) return "gold";
    if (positionNumeric === 2) return "silver";
    if (positionNumeric === 3) return "bronze";
    return null;
  }

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (rows.length === 0) {
    return (
      <div className="border-2 border-dashed border-border p-12 text-center bg-card/30">
        <p className="font-display text-sm uppercase mb-2">Major7s Scoring</p>
        <p className="text-sm text-muted-foreground">
          Major7s scoring will appear here once results are tallied.
        </p>
      </div>
    );
  }

  const myRow = myTeamId ? rows.find((r) => r.team_id === myTeamId) ?? null : null;

  return (
    <div className="space-y-3">
      <div className="text-right text-xs uppercase tracking-widest text-muted-foreground">
        {rows.length} {rows.length === 1 ? "team" : "teams"}
      </div>
      {myRow && (
        <ActiveTeamPanel row={myRow} medal={medalFor(myRow.position_numeric)} />
      )}
      <div className="border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <MajorCols />
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-center px-3 py-2 w-20">Pos</th>
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-right px-3 py-2 w-24">Points</th>
              <th className="text-center px-3 py-2 w-24">Thru Cut</th>
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <ExpandableTeamRow
                key={r.id}
                r={r}
                mine={!!myTeamId && r.team_id === myTeamId}
                medal={medalFor(r.position_numeric)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActiveTeamPanel({
  row, medal,
}: { row: ScoreRow; medal: "gold" | "silver" | "bronze" | null }) {
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-md overflow-hidden">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <MajorCols />
        <thead className="text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800">
          <tr>
            <th className="text-left px-3 py-1.5">Your Team</th>
            <th />
            <th className="text-right px-3 py-1.5">Points</th>
            <th className="text-center px-3 py-1.5">Thru Cut</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-3 py-2 text-center">
              <div className="inline-flex justify-center">
                <PositionMedal positionDisplay={row.position_display} medal={medal} size="sm" />
              </div>
            </td>
            <td className="px-3 py-2 font-medium truncate">{row.teams?.nickname ?? "—"}</td>
            <td className="px-3 py-2 text-right font-mono font-semibold">{row.total_points}</td>
            <td className="px-3 py-2 text-center font-mono text-muted-foreground">{row.thru_cut}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PositionMedal({
  positionDisplay, medal, size = "sm",
}: { positionDisplay: string; medal: "gold" | "silver" | "bronze" | null; size?: "sm" | "lg" }) {
  // Sizes: small for table rows, large for the active-team panel.
  const dim = size === "lg" ? "w-12 h-12 text-base" : "w-9 h-9 text-xs";
  // Plain (non-medal) position: monospaced text, no circle.
  if (!medal) {
    return <span className="font-mono text-xs">{positionDisplay}</span>;
  }
  // Metallic gradients via inline styles (Tailwind doesn't have these out of the box).
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
        <td className="px-3 py-2 text-center">
          <div className="inline-flex justify-center">
            <PositionMedal positionDisplay={r.position_display} medal={medal} size="sm" />
          </div>
        </td>
        <td className="px-3 py-2 font-medium">{r.teams?.nickname ?? "—"}</td>
        <td className="px-3 py-2 text-right font-mono font-semibold">{r.total_points}</td>
        <td className="px-3 py-2 text-center font-mono text-muted-foreground">{r.thru_cut}</td>
        <td className="px-3 py-2 text-muted-foreground">
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
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

const NON_FINISHER_POINTS = 100;

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
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <MajorCols />
        <tbody>
          {picks.map((p) => {
            const cutLike = p.points === NON_FINISHER_POINTS;
            // Four-state styling matrix (counted/muted x finished/cut)
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
                <td className={`pl-8 pr-3 py-0.5 text-muted-foreground ${nameCls}`}>
                  B{p.bucket}
                </td>
                <td className={`pl-2 pr-3 py-0.5 ${nameCls}`}>{p.golfer_name}</td>
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
