import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Star } from "lucide-react";
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
  const [view, setView] = useState<View>("tournament");

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

  // Picks for the active team (or effective user's team in shadow mode) for this tournament.
  // Used to highlight rows belonging to my picks.
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

  // Sort: active/finished players first (by position_numeric asc, then total asc, then name),
  // then cut/withdrawn at the bottom (alphabetical).
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

      {/* Segmented toggle */}
      <div className="inline-flex rounded-md border border-border bg-card p-1 mb-6">
        <button
          type="button"
          onClick={() => setView("tournament")}
          className={`px-4 py-1.5 text-xs uppercase tracking-widest font-bold rounded ${
            view === "tournament" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Tournament
        </button>
        <button
          type="button"
          onClick={() => setView("major7s")}
          className={`px-4 py-1.5 text-xs uppercase tracking-widest font-bold rounded ${
            view === "major7s" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Major7s
        </button>
      </div>

      {view === "major7s" ? (
        <MajorSevenPlaceholder />
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

function MajorSevenPlaceholder() {
  return (
    <div className="border-2 border-dashed border-border p-12 text-center bg-card/30">
      <p className="font-display text-sm uppercase mb-2">Major7s Scoring</p>
      <p className="text-sm text-muted-foreground">
        Major7s scoring will appear here once results are tallied.
      </p>
    </div>
  );
}

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
            <Row key={r.id} r={r} mine={!!r.golfer_id && myPickGolferIds.has(r.golfer_id)} />
          ))}
          {cut.length > 0 && (
            <>
              <tr className="bg-muted/30">
                <td colSpan={8} className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                  Missed Cut / Withdrew
                </td>
              </tr>
              {cut.map((r) => (
                <Row key={r.id} r={r} mine={!!r.golfer_id && myPickGolferIds.has(r.golfer_id)} dim />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({ r, mine, dim }: { r: LbRow; mine: boolean; dim?: boolean }) {
  const par = fmtToPar(r.score_to_par);
  const pos = r.position_display ?? "—";
  const posLabel = r.is_tie && r.position_numeric !== null ? `T${r.position_numeric}` : pos;

  // Subtle gold tint for picked rows; muted text for cut/withdrawn.
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
