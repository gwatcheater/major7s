import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Newspaper, CalendarDays, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import blogDefault from "@/assets/blog-default.png.asset.json";

export const Route = createFileRoute("/_authenticated/blog/")({
  component: BlogIndex,
});

// Rough plain-text extraction from markdown, good enough for a short card
// excerpt — strips images/links/code/formatting chars without pulling in a
// full markdown parser on the list page.
function excerptFromBody(body: string | null, maxLen = 110): string {
  if (!body) return "";
  const clean = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxLen) return clean;
  const slice = clean.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > maxLen * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[.,;:!?-]+$/, "")}…`;
}

function readMinutes(body: string | null): number {
  const words = (body ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function BlogIndex() {
  const { isAdmin } = useAuth();

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["blog_posts_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, title, body, created_at, image_url, tournament_id")
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
        .select("id, name, start_date")
        .in("id", tournamentIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const tnameById = new Map(
    tournaments.map((t) => {
      const year = t.start_date ? new Date(t.start_date).getFullYear() : null;
      return [t.id, year ? `${t.name} ${year}` : t.name];
    }),
  );

  return (
    <div className="p-4 md:p-12 max-w-6xl mx-auto">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((p) => {
            const tName = p.tournament_id ? tnameById.get(p.tournament_id) : null;
            const linkProps = p.tournament_id
              ? {
                  to: "/tournament/$id/blog/$postId" as const,
                  params: { id: p.tournament_id, postId: p.id },
                  search: { from: "blog" as const },
                }
              : { to: "/blog/$postId" as const, params: { postId: p.id } };
            const excerpt = excerptFromBody(p.body);
            const mins = readMinutes(p.body);

            return (
              <Link
                key={p.id}
                {...linkProps}
                className="group flex flex-col border border-border bg-card rounded-lg overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="aspect-[16/10] w-full overflow-hidden bg-muted">
                  <img
                    src={p.image_url ?? blogDefault.url}
                    alt=""
                    className={`w-full h-full transition-transform duration-300 group-hover:scale-[1.03] ${
                      p.image_url ? "object-cover" : "object-contain p-8"
                    }`}
                  />
                </div>
                <div className="p-4 flex flex-col flex-1">
                  <div
                    className="uppercase tracking-widest text-[10px] font-bold mb-1.5"
                    style={{ color: "var(--gold)" }}
                  >
                    {tName ?? "General"}
                  </div>
                  <h2 className="font-display text-lg leading-snug mb-1.5">{p.title}</h2>
                  {excerpt && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{excerpt}</p>
                  )}
                  <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground pt-2">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="w-3.5 h-3.5" />
                      {new Date(p.created_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {mins} min
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
