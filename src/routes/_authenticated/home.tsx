import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Countdown } from "@/components/countdown";
import { useTeams } from "@/hooks/use-teams";
import { tournamentDateRange } from "@/lib/format";
import { tournamentCardLink } from "@/lib/tournament-link";
import { CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
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

function StatusBadge({ status }: { status: Tournament["status"] }) {
  // Subtle rounded pills: muted backgrounds, colour carried in the text.
  const map: Record<Tournament["status"], { label: string; bg: string; color: string }> = {
    upcoming:       { label: "Upcoming",        bg: "rgb(226 232 240)", color: "rgb(51 65 85)"   }, // slate, deeper
    open_for_picks: { label: "Open for Picks",  bg: "rgb(187 247 208)", color: "rgb(20 83 45)"   }, // green, deeper
    picks_closed:   { label: "Picks Closed",    bg: "rgb(226 232 240)", color: "rgb(51 65 85)"   }, // slate, deeper
    live:           { label: "Live",            bg: "rgb(253 230 138)", color: "rgb(120 53 15)"  }, // amber, deeper
    completed:      { label: "Completed",       bg: "rgb(226 232 240)", color: "rgb(51 65 85)"   }, // slate, deeper
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

function PicksBadge({ complete }: { complete: boolean }) {
  // Subtle rounded pill matching the StatusBadge style.
  const styles = complete
    ? { bg: "rgb(187 247 208)", color: "rgb(20 83 45)",  label: "Picks Selected" }       // green, deeper
    : { bg: "rgb(254 202 202)", color: "rgb(127 29 29)", label: "Picks Not Selected" };  // red, deeper
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full inline-flex items-center gap-1"
      style={{ backgroundColor: styles.bg, color: styles.color }}
    >
      {complete ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
      {styles.label}
    </span>
  );
}

function HomePage() {
  const { activeTeam } = useTeams();

  const { data: tournaments = [], isLoading } = useQuery({
    queryKey: ["tournaments-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .in("status", ["upcoming", "open_for_picks", "picks_closed", "live"])
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data as Tournament[];
    },
  });

  const { data: pickCounts = {} } = useQuery({
    queryKey: ["roster-status", activeTeam?.id, tournaments.map((t) => t.id).join(",")],
    enabled: !!activeTeam && tournaments.length > 0,
    queryFn: async () => {
      const out: Record<string, number> = {};
      for (const t of tournaments) {
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

  return (
    <div className="p-4 md:p-12 max-w-6xl">
      <header className="mb-6" />

      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          Loading the leaderboard...
        </div>
      ) : tournaments.length === 0 ? (
        <div className="border-2 border-dashed border-border p-16 text-center">
          <h3 className="font-display text-xl uppercase mb-2">No tournaments yet</h3>
          <p className="text-sm text-muted-foreground">
            An admin needs to create the season's tournaments in the Admin Panel.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          {tournaments.map((t, i) => {
            const picks = pickCounts[t.id] ?? 0;
            const complete = picks >= 7;
            const isOpen = t.status === "open_for_picks";
            const lockExpired = new Date(t.submission_deadline).getTime() <= Date.now();
            const link = tournamentCardLink(t);
            const showLineupCta = isOpen && !lockExpired;
            return (
              <div
                key={t.id}
                className="relative bg-card border border-border rounded-xl overflow-hidden flex flex-col md:flex-row hover:border-primary/40 hover:shadow-lg transition-all animate-reveal"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {/* Full-card click target navigates to the hub */}
                <Link
                  to={link.to}
                  params={link.params}
                  aria-label={`Open ${t.name}`}
                  className="absolute inset-0 z-10"
                />
                <div
                  className="absolute top-0 left-0 w-1.5 h-full pointer-events-none"
                  style={{ backgroundColor: isOpen ? "var(--gold)" : "var(--forest)" }}
                />
                <div className="flex-1 p-5 md:p-8 relative pointer-events-none">
                  {/* Status badges row — top right, both on one row */}
                  <div className="flex justify-end gap-2 mb-4 flex-wrap">
                    <StatusBadge status={t.status} />
                    {activeTeam && <PicksBadge complete={complete} />}
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
                      <h3 className="font-display text-2xl md:text-3xl uppercase leading-tight break-words">
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

                  {showLineupCta ? (
                    <div className="flex items-end justify-between border-t border-border pt-4 mt-6 flex-wrap gap-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
                          Picks Close In
                        </span>
                        <Countdown targetIso={t.submission_deadline} />
                      </div>
                      <Link
                        to="/tournament/$id/lineup"
                        params={{ id: t.id }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative z-20 pointer-events-auto inline-flex items-center gap-2 px-6 py-3 font-display text-xs uppercase tracking-widest text-white rounded-full shadow-md hover:shadow-lg hover:scale-[1.03] transition-all"
                        style={{
                          background: "linear-gradient(135deg, var(--forest-deep) 0%, var(--forest) 50%, var(--gold) 110%)",
                        }}
                      >
                        Picks
                        <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                      </Link>
                    </div>
                  ) : (
                    <div className="border-t border-border pt-4 mt-6 text-xs text-muted-foreground">
                      View tournament hub →
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
