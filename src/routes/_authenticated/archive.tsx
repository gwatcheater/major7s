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

function StatusBadge({ status }: { status: Tournament["status"] }) {
  const map: Record<Tournament["status"], { label: string; bg: string; color: string }> = {
    upcoming: { label: "Upcoming · Locked", bg: "var(--muted)", color: "var(--muted-foreground)" },
    open_for_picks: { label: "Open for Picks", bg: "var(--forest)", color: "white" },
    picks_closed: { label: "Picks Closed", bg: "var(--muted)", color: "var(--muted-foreground)" },
    live: { label: "Live · In Progress", bg: "var(--alert)", color: "white" },
    completed: { label: "Completed", bg: "var(--muted)", color: "var(--muted-foreground)" },
  };
  const m = map[status];
  return (
    <span
      className="font-display text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full"
      style={{ backgroundColor: m.bg, color: m.color }}
    >
      {m.label}
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

  return (
    <div className="p-4 md:p-12 max-w-6xl">
      <header className="mb-10">
        <p
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--gold)" }}
        >
          The Season
        </p>
        <h1
          className="font-display text-4xl md:text-5xl uppercase mt-1"
          style={{ color: "var(--forest-deep)" }}
        >
          Event <span style={{ color: "var(--gold)" }}>Archive</span>
        </h1>
      </header>

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
            return (
              <div
                key={t.id}
                className="relative bg-card border border-border overflow-hidden flex flex-col md:flex-row hover:border-primary/30 transition-colors animate-reveal"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <Link
                  to={link.to}
                  params={link.params}
                  aria-label={`Open ${t.name}`}
                  className="absolute inset-0 z-10"
                />
                <div
                  className="absolute top-0 left-0 w-1 h-full pointer-events-none"
                  style={{ backgroundColor: "var(--forest)" }}
                />
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
                        <p
                          className="text-[11px] font-bold uppercase tracking-[0.2em]"
                          style={{ color: "var(--gold)" }}
                        >
                          {tournamentDateRange(t.start_date, t.end_date)}
                        </p>
                        <h3 className="font-display text-2xl md:text-3xl uppercase mt-1 leading-none">
                          {t.name}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-2">{t.location}</p>
                      </div>
                    </div>
                    <div className="flex flex-row items-start gap-2 shrink-0">
                      <StatusBadge status={t.status} />
                      {activeTeam && (
                        <span
                          className="font-display text-[10px] uppercase tracking-widest px-2 py-1 rounded-full flex items-center gap-1"
                          style={{
                            backgroundColor: entered ? "var(--forest-deep)" : "var(--muted)",
                            color: entered ? "white" : "var(--muted-foreground)",
                          }}
                        >
                          {entered ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <AlertCircle className="size-3" />
                          )}
                          {entered ? "Entered" : "Did Not Enter"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-border pt-4 mt-4 text-xs text-muted-foreground">
                    View results →
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
