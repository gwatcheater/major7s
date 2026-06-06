import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  MapPin,
  Calendar,
  Clipboard,
  CheckCircle2,
  Trophy,
  BarChart3,
  FileText,
  ChevronRight,
  Plus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTeams } from "@/hooks/use-teams";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonation } from "@/context/impersonation-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { tournamentDateRange } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tournament/$id")({
  component: TournamentHub,
});

const STATUS_META: Record<string, { label: string; className: string }> = {
  upcoming: { label: "Upcoming", className: "bg-muted text-muted-foreground" },
  open_for_picks: { label: "Open for Picks", className: "bg-primary text-primary-foreground" },
  picks_closed: { label: "Picks Closed", className: "bg-destructive text-destructive-foreground" },
  live: { label: "Live", className: "bg-primary/15 text-primary border border-primary/30" },
  completed: { label: "Completed", className: "bg-secondary text-secondary-foreground" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
}

function TournamentHub() {
  const { id } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { activeTeam } = useTeams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [blogOpen, setBlogOpen] = useState(false);
  console.log("[tournament hub debug]", { userId: user?.id, email: user?.email, isAdmin });

  const { data: t, isLoading } = useQuery({
    queryKey: ["tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: picks = [] } = useQuery({
    queryKey: ["picks", activeTeam?.id, id],
    enabled: !!activeTeam,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks")
        .select("id, bucket, golfer_id, last_edited_at, submitted_at, tweak_count")
        .eq("team_id", activeTeam!.id)
        .eq("tournament_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: golfers = [] } = useQuery({
    queryKey: ["golfers", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, golfer_name")
        .eq("tournament_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", effectiveId],
    enabled: !!effectiveId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", effectiveId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: blogPosts = [] } = useQuery({
    queryKey: ["blog_posts", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, title, created_at")
        .eq("tournament_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="p-12">Loading…</div>;
  if (!t) return <div className="p-12">Tournament not found.</div>;
  if (
    pathname.endsWith(`/tournament/${id}/lineup`) ||
    pathname.endsWith(`/tournament/${id}/leaderboard`) ||
    pathname.endsWith(`/tournament/${id}/stats`) ||
    pathname.includes(`/tournament/${id}/blog`)
  ) return <Outlet />;

  const meta = statusMeta(t.status);
  const lockExpired = new Date(t.submission_deadline).getTime() <= Date.now();
  const canSubmit = t.status === "open_for_picks" && !lockExpired;

  const golferNameById = new Map<string, string>(
    golfers.map((g: any) => [g.id, g.golfer_name]),
  );

  const picksByBucket = new Map<number, { name: string }>();
  let lastEdited = 0;
  for (const p of picks) {
    const name = golferNameById.get((p as any).golfer_id) ?? "—";
    picksByBucket.set(p.bucket as number, { name });
    const ts = new Date(p.last_edited_at as string).getTime();
    if (ts > lastEdited) lastEdited = ts;
  }
  const hasPicks = picks.length > 0;
  const maxTweaks = picks.reduce((m, p: any) => Math.max(m, p.tweak_count ?? 0), 0);
  const teamHandle = activeTeam?.nickname || profile?.nickname || "Your Team";

  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto">
      <Link
        to={t.status === "completed" ? "/archive" : "/home"}
        className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        ← {t.status === "completed" ? "Archive" : "Live & Upcoming"}
      </Link>

      {/* HEADER */}
      <header className="mt-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          {t.logo_url ? (
            <img
              src={t.logo_url}
              alt={`${t.name} logo`}
              className="w-16 h-16 sm:w-20 sm:h-20 object-contain border border-border bg-card shrink-0"
            />
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 border border-border bg-muted shrink-0" />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-3xl md:text-5xl uppercase leading-tight">{t.name}</h1>
            <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {t.location}
              </span>
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {tournamentDateRange(t.start_date, t.end_date)}
              </span>
            </div>
          </div>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 text-[10px] font-bold uppercase tracking-widest shrink-0 ${meta.className}`}
        >
          {meta.label}
        </span>
      </header>

      {/* PICKS CARD */}
      <Card className="mt-8 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Clipboard className="h-5 w-5" />
              <span className="font-display text-lg uppercase">Picks</span>
            </div>
            {hasPicks ? (
              <Badge className="bg-green-600 text-white hover:bg-green-600">Picks Submitted</Badge>
            ) : (
              <Badge variant="destructive">Not Entered</Badge>
            )}
          </div>
          {hasPicks && lastEdited > 0 && (
            <div className="text-xs text-muted-foreground">
              Submitted: {new Date(lastEdited).toLocaleString()}
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-display uppercase text-base">{teamHandle}</span>
            {hasPicks && <CheckCircle2 className="h-4 w-4 text-green-600" />}
          </div>
          {hasPicks && (
            <div className="mt-1 text-xs text-muted-foreground">
              Tweaks: {maxTweaks}
            </div>
          )}
        </div>

        {hasPicks ? (
          <>
            <div className="mt-4 divide-y divide-border border border-border">
              {[1, 2, 3, 4, 5, 6, 7].map((b) => {
                const pick = picksByBucket.get(b);
                return (
                  <div key={b} className="flex items-center justify-between px-4 py-3 gap-4">
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      Bucket {b}
                    </span>
                    <span className="text-sm font-medium text-right truncate">
                      {pick?.name ?? <span className="text-muted-foreground">—</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {canSubmit && (
              <Link
                to="/tournament/$id/lineup"
                params={{ id }}
                className="mt-5 block w-full text-center py-3 font-display text-xs uppercase tracking-widest border border-border bg-background hover:bg-accent transition-colors"
              >
                Edit Picks
              </Link>
            )}
          </>
        ) : (
          <Link
            to="/tournament/$id/lineup"
            params={{ id }}
            className="mt-5 block w-full text-center py-4 font-display text-xs uppercase tracking-widest text-white"
            style={{ backgroundColor: "var(--forest-deep)" }}
            aria-disabled={!canSubmit}
          >
            {canSubmit ? "Submit Team Lineup →" : "View Lineup →"}
          </Link>
        )}
      </Card>

      {/* NAV ROWS (stacked) */}
      <div className="mt-6 flex flex-col gap-3">
        <Link
          to="/tournament/$id/leaderboard"
          params={{ id }}
          className="flex items-center gap-3 p-4 border border-border bg-card hover:bg-accent transition-colors"
        >
          <Trophy className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="font-display text-sm uppercase">Leaderboard</div>
            <div className="text-xs text-muted-foreground">Final standings</div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        {(["picks_closed", "live", "completed"].includes(t.status)) && (
          <Link
            to="/tournament/$id/stats"
            params={{ id }}
            className="flex items-center gap-3 p-4 border border-border bg-card hover:bg-accent transition-colors"
          >
            <BarChart3 className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="font-display text-sm uppercase">Statistics</div>
              <div className="text-xs text-muted-foreground">Pick stats & fun facts — Tap to view</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}

        <Collapsible open={blogOpen} onOpenChange={setBlogOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-3 p-4 border border-border bg-card hover:bg-accent transition-colors">
            <FileText className="h-5 w-5 text-primary" />
            <div className="flex-1 text-left">
              <div className="font-display text-sm uppercase">Blog</div>
              <div className="text-xs text-muted-foreground">Tournament recap & notes</div>
            </div>
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${blogOpen ? "rotate-90" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="border border-t-0 border-border bg-card">
            {isAdmin ? (
              <Button
                asChild
                variant="ghost"
                className="w-full justify-start gap-3 p-4 h-auto rounded-none border-b border-border hover:bg-accent"
              >
                <Link to="/tournament/$id/blog/new" params={{ id }}>
                  <Plus className="h-4 w-4 text-primary shrink-0" />
                  <span className="flex-1 text-left font-display text-sm uppercase">
                    New Post
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </Button>
            ) : import.meta.env.DEV ? (
              <div className="p-4 text-xs text-muted-foreground border-b border-border">
                [dev] New Post hidden — isAdmin={String(isAdmin)} user={user?.email ?? "none"}
              </div>
            ) : null}
            {blogPosts.length > 0 ? (
              <ul className="divide-y divide-border">
                {blogPosts.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/tournament/$id/blog/$postId"
                      params={{ id, postId: p.id }}
                      className="flex items-center gap-3 p-4 hover:bg-accent transition-colors"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5 text-sm text-muted-foreground whitespace-pre-wrap">
                {t.recap_blog ?? "No recap yet. Check back after the tournament concludes."}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
