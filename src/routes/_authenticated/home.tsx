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
  const map: Record<Tournament["status"], { label: string; bg: string; color: string }> = {
    upcoming: { label: "Upcoming · Locked", bg: "var(--muted)", color: "var(--muted-foreground)" },
    open_for_picks: { label: "Open for Picks", bg: "var(--forest)", color: "white" },
    picks_closed: { label: "Picks Closed", bg: "var(--muted)", color: "var(--muted-foreground)" },
    live: { label: "Live · In Progress", bg: "var(--alert)", color: "white" },
    completed: { label: "Completed", bg: "var(--forest-deep)", color: "white" },
  };
  const m = map[status];
  return (
    <span className="font-display text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-sm" style={{ backgroundColor: m.bg, color: m.color }}>
      {m.label}
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
      <header className="mb-10 flex justify-between items-end flex-wrap gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
            The Season
          </p>
          <h1 className="font-display text-4xl md:text-5xl uppercase mt-1" style={{ color: "var(--forest-deep)" }}>
            Tournament <span style={{ color: "var(--gold)" }}>Feed</span>
          </h1>
        </div>
        {activeTeam && (
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Active Team</div>
            <div className="font-display text-xl uppercase">{activeTeam.nickname}</div>
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading the leaderboard...</div>
      ) : tournaments.length === 0 ? (
        <div className="border-2 border-dashed border-border p-16 text-center">
          <h3 className="font-display text-xl uppercase mb-2">No tournaments yet</h3>
          <p className="text-sm text-muted-foreground">An admin needs to create the season's tournaments in the Admin Panel.</p>
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
                className="relative bg-card border border-border overflow-hidden flex flex-col md:flex-row hover:border-primary/30 transition-colors animate-reveal"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {/* Full-card click target navigates to the hub */}
                <Link
                  to={link.to}
                  params={link.params}
                  aria-label={`Open ${t.name}`}
                  className="absolute inset-0 z-10"
                />
                <div className="absolute top-0 left-0 w-1 h-full pointer-events-none" style={{ backgroundColor: isOpen ? "var(--gold)" : "var(--forest)" }} />
                <div className="flex-1 p-6 md:p-8 relative pointer-events-none">
                  <div className="flex justify-between items-start mb-6 gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      {t.logo_url && (
                        <img
                          src={t.logo_url}
                          alt={`${t.name} logo`}
                          className="h-12 w-12 object-contain rounded-lg border bg-card shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--gold)" }}>
                          {tournamentDateRange(t.start_date, t.end_date)}
                        </p>
                        <h3 className="font-display text-2xl md:text-3xl uppercase mt-1 leading-none">{t.name}</h3>
                        <p className="text-sm text-muted-foreground mt-2">{t.location}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <StatusBadge status={t.status} />
                      {activeTeam && (
                        <span
                          className="font-display text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm flex items-center gap-1"
                          style={{
                            backgroundColor: complete ? "var(--success)" : "var(--alert)",
                            color: "white",
                          }}
                        >
                          {complete ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
                          {complete ? "Picks Selected" : "Picks Not Selected"}
                        </span>
                      )}
                    </div>
                  </div>

                  {showLineupCta ? (
                    <div className="flex items-end justify-between border-t border-border pt-4 mt-4 flex-wrap gap-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
                          Registration Closes In
                        </span>
                        <Countdown targetIso={t.submission_deadline} />
                      </div>
                      <Link
                        to="/tournament/$id/lineup"
                        params={{ id: t.id }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative z-20 pointer-events-auto px-6 py-3 font-display text-[10px] uppercase tracking-widest text-white"
                        style={{ backgroundColor: "var(--forest-deep)" }}
                      >
                        {complete ? "Edit Lineup →" : "Enter Lineup →"}
                      </Link>
                    </div>
                  ) : (
                    <div className="border-t border-border pt-4 mt-4 text-xs text-muted-foreground">
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
