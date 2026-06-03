import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, ChevronRight, Newspaper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/blog/")({
  component: BlogIndex,
});

function BlogIndex() {
  const { isAdmin } = useAuth();

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["blog_posts_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, title, created_at, image_url, tournament_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const tournamentIds = Array.from(
    new Set(posts.map((p) => p.tournament_id).filter((x): x is string => !!x)),
  );

  const { data: tournaments = [] } = useQuery({
    queryKey: ["tournaments_for_blog", tournamentIds.join(",")],
    enabled: tournamentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("id, name")
        .in("id", tournamentIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const tnameById = new Map(tournaments.map((t) => [t.id, t.name]));

  return (
    <div className="p-4 md:p-12 max-w-3xl mx-auto">
      <header className="flex items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
            All Posts
          </p>
          <h1 className="font-display text-3xl md:text-5xl uppercase mt-1 flex items-center gap-3">
            <Newspaper className="w-8 h-8" /> Blog
          </h1>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link to="/blog/new">
              <Plus className="w-4 h-4" /> New Post
            </Link>
          </Button>
        )}
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No blog posts yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {posts.map((p) => {
            const tName = p.tournament_id ? tnameById.get(p.tournament_id) : null;
            const linkProps = p.tournament_id
              ? { to: "/tournament/$id/blog/$postId" as const, params: { id: p.tournament_id, postId: p.id } }
              : { to: "/blog/$postId" as const, params: { postId: p.id } };
            return (
              <li key={p.id}>
                <Link
                  {...linkProps}
                  className="flex items-center gap-4 p-4 hover:bg-accent transition-colors"
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt=""
                      className="w-16 h-16 object-cover rounded-sm border border-border shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 grid place-items-center bg-muted border border-border shrink-0">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>
                        {new Date(p.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span>·</span>
                      <span className="uppercase tracking-widest text-[10px] font-bold" style={{ color: "var(--gold)" }}>
                        {tName ?? "General"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
