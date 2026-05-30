import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeams } from "@/hooks/use-teams";
import { tournamentDateRange } from "@/lib/format";
import { tournamentCardLink } from "@/lib/tournament-link";
import { CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/archive")({
  component: ArchivePage,
});

interface Tournament {
  id: string;
  name: string;
  location: string;
  start_date: string;
  end_date: string;
  submission_deadline: string;
  status: "upcoming" | "open_for_picks" | "picks_closed" | "live" | "completed";
  logo_url?: string;
}

interface ArchiveScoreRow {
  tournament_id: string;
  total_points: number;
  position_display: string;
  position_numeric: number;
  thru_cut: number;
}

function StatusBadge({ status }: { status: Tournament["status"] }) {
  const map: Record<Tournament["status"], { label: string; bg: string; color: string }> = {
    upcoming:       { label: "Upcoming",       bg: "rgb(226 232 240)", color: "rgb(51 65 85)"  },
    open_for_picks: { label: "Open for Picks", bg: "rgb(187 247 208)", color: "rgb(20 83 45)"  },
    picks_closed:   { label: "Picks Closed",   bg: "rgb(226 232 240)", color: "rgb(51 65 85)"  },
    live:           { label: "Live",           bg: "rgb(253 230 138)", color: "rgb(120 53 15)" },
    completed:      { label: "Completed",      bg: "rgb(226 232 240)", color: "rgb(51 65 85)"  },
  };
  const m = map[status];
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
      style={{ backgroundColor: m.bg, color: m.color }}
    >
      {m.label}
    </span>
  );
}

function EnteredBadge({ entered }: { entered: boolean }) {
  // Matches the PicksBadge style on the live cards — subtle rounded pill.
  const styles = entered
    ? { bg: "rgb(187 247 208)", color: "rgb(20 83 45)",  label: "Entered" }       // green
    : { bg: "rgb(226 232 240)", color: "rgb(51 65 85)",  label: "Did Not Enter" }; // slate
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full inline-flex items-center gap-1"
      style={{ backgroundColor: styles.bg, color: styles.color }}
    >
      {entered ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
      {styles.label}
    </span>
  );
}

function ArchivePage() {
  const { activeTeam } = useTeams();

  const { data: completedTournaments = [], isLoading } = useQuery({
    queryKey: ["tournaments-completed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("status", "completed")
        .order("end_date", { ascending: false });
      if (error) throw error;
      return data as Tournament[];
    },
  });

  const { data: pickCounts = {} } = useQuery({
    queryKey: [
      "archive-entry-status",
      activeTeam?.id,
      completedTournaments.map((t) => t.id).join(","),
    ],
    enabled: !!activeTeam && completedTournaments.length > 0,
    queryFn: async () => {
      const out: Record<string, number> = {};
      for (const t of completedTournaments) {
        const { count } = await supabase
          .from("picks")
          .select("*", { count: "exact", head: true })
          .eq("team_id", activeTeam!.id)
          .eq("tournament_id", t.id);
        out[t.id] = count ?? 0;
      }
      return out;
    },
  });

  // Active team's final score & position per completed tournament, where it exists.
  // Used for the bottom-of-card result strip.
  const { data: teamScores = {} } = useQuery({
    queryKey: [
      "archive-team-scores",
      activeTeam?.id,
      completedTournaments.map((t) => t.id).join(","),
    ],
    enabled: !!activeTeam && completedTournaments.length > 0,
    queryFn: async () => {
      const out: Record<string, ArchiveScoreRow> = {};
      const tournamentIds = completedTournaments.map((t) => t.id);
      if (tournamentIds.length === 0) return out;
      const { data, error } = await supabase
        .from("tournament_scores")
        .select("tournament_id, total_points, position_display, position_numeric, thru_cut")
        .eq("team_id", activeTeam!.id)
        .in("tournament_id", tournamentIds);
      if (error) throw error;
      for (const row of (data ?? []) as ArchiveScoreRow[]) {
        out[row.tournament_id] = row;
      }
      return out;
    },
  });

  return (
    <div className="p-4 md:p-12 max-w-6xl">
      <header className="mb-6" />

      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading archive...</div>
      ) : completedTournaments.length === 0 ? (
        <div className="border-2 border-dashed border-border p-16 text-center">
          <p className="text-sm text-muted-foreground">
            No completed tournaments yet — finished events will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          {completedTournaments.map((t, i) => {
            const link = tournamentCardLink(t);
            const entered = (pickCounts[t.id] ?? 0) > 0;
            const score = teamScores[t.id];
            return (
              <div
                key={t.id}
                className="relative bg-card border border-border rounded-xl overflow-hidden flex flex-col group hover:border-primary/40 hover:shadow-lg transition-all animate-reveal"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {/* Full-card click target navigates to the hub */}
                <Link
                  to={link.to}
                  params={link.params}
                  aria-label={`Open ${t.name}`}
                  className="absolute inset-0 z-10"
                />
                {/* Left accent stripe — forest tone for completed events */}
                <div
                  className="absolute top-0 left-0 w-1.5 h-full pointer-events-none"
                  style={{ backgroundColor: "var(--forest)" }}
                />

                <div className="flex-1 p-5 md:p-8 relative pointer-events-none">
                  {/* Status badges row — top right, both on one row */}
                  <div className="flex justify-end gap-2 mb-4 flex-wrap">
                    <StatusBadge status={t.status} />
                    {activeTeam && <EnteredBadge entered={entered} />}
                  </div>

                  {/* Identity row — logo left, name/venue/dates stacked right */}
                  <div className="flex items-start gap-4 min-w-0">
                    {t.logo_url ? (
                      <img
                        src={t.logo_url}
                        alt={`${t.name} logo`}
                        className="h-20 w-20 object-contain rounded-lg border bg-card shrink-0"
                      />
                    ) : (
                      <div className="h-20 w-20 rounded-lg border bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-2xl md:text-3xl leading-tight break-words">
                        {t.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1.5">{t.location}</p>
                      <p
                        className="text-[11px] font-bold uppercase tracking-[0.2em] mt-1.5"
                        style={{ color: "var(--gold)" }}
                      >
                        {tournamentDateRange(t.start_date, t.end_date)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Bottom strip — equivalent of the live cards' gold countdown.
                   Shows the team's final result (position + points) when entered
                   and scored, then a LEADERBOARD button on the right. */}
                <div
                  className="relative flex items-stretch justify-between gap-3 px-5 py-3 md:px-8 md:py-4"
                  style={{
                    background: "linear-gradient(90deg, rgba(34,83,57,0.10) 0%, rgba(34,83,57,0.03) 100%)",
                    borderTop: "1px solid rgba(34,83,57,0.25)",
                  }}
                >
                  <div className="flex flex-col justify-center min-w-0">
                    {score ? (
                      <>
                        <span className="text-[10px] font-bold text-emerald-900/70 uppercase tracking-widest leading-none mb-1.5">
                          Your Result
                        </span>
                        <div className="font-mono font-bold text-base md:text-lg leading-none tracking-tight text-emerald-950 flex items-baseline gap-3">
                          <span>{score.position_display}</span>
                          <span className="text-sm font-normal text-muted-foreground">·</span>
                          <span>{score.total_points} pts</span>
                        </div>
                      </>
                    ) : entered ? (
                      <span className="text-xs italic text-muted-foreground">
                        Result pending
                      </span>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">
                        Did not enter
                      </span>
                    )}
                  </div>
                  <Link
                    to="/tournament/$id/leaderboard"
                    params={{ id: t.id }}
                    onClick={(e) => e.stopPropagation()}
                    className="relative z-20 pointer-events-auto self-center inline-flex items-center gap-2 px-6 py-3 font-display text-xs uppercase tracking-widest text-white rounded-full shadow-md hover:shadow-xl hover:scale-[1.04] transition-all"
                    style={{
                      background: "linear-gradient(135deg, var(--forest-deep) 0%, var(--forest) 50%, var(--gold) 110%)",
                    }}
                  >
                    Leaderboard
                    <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
