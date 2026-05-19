import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Countdown } from "@/components/countdown";

export const Route = createFileRoute("/_authenticated/tournament/$id")({
  component: TournamentHub,
});

function TournamentHub() {
  const { id } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: t, isLoading } = useQuery({
    queryKey: ["tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="p-12">Loading…</div>;
  if (!t) return <div className="p-12">Tournament not found.</div>;

  if (pathname.endsWith(`/tournament/${id}/lineup`)) return <Outlet />;

  const isOpen = t.status === "open_for_picks" && new Date(t.submission_deadline).getTime() > Date.now();

  return (
    <div className="p-4 md:p-12 max-w-5xl">
      <Link to="/home" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Feed</Link>
      <h1 className="font-display text-4xl md:text-5xl uppercase mt-4">{t.name}</h1>
      <p className="text-muted-foreground mt-1">{t.course}</p>
      <div className="mt-2 text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--gold)" }}>Status · {t.status}</div>

      <div className="mt-8 p-6 border border-border bg-card flex items-center justify-between flex-wrap gap-4">
        <div>
          {isOpen ? (
            <>
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Registration Closes In</div>
              <Countdown targetIso={t.submission_deadline} />
            </>
          ) : (
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {t.status === "open_for_picks" ? "Picks Locked" : `Tournament ${t.status}`}
            </div>
          )}
        </div>
        <Link to="/tournament/$id/lineup" params={{ id }} className="px-6 py-3 font-display text-xs uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>
          {isOpen ? "Enter Lineup →" : "View Lineup →"}
        </Link>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-xl uppercase mb-3">Recap</h2>
        <p className="text-sm text-muted-foreground">{t.recap_blog ?? "No recap yet. Check back after the tournament concludes."}</p>
      </div>
    </div>
  );
}
