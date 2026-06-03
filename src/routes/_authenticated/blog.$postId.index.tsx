import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Pencil } from "lucide-react";
import { linkify } from "@/lib/linkify";

export const Route = createFileRoute("/_authenticated/blog/$postId/")({
  component: GeneralBlogPostView,
});

function GeneralBlogPostView() {
  const { postId } = Route.useParams();
  const { isAdmin } = useAuth();

  const { data: post, isLoading } = useQuery({
    queryKey: ["blog_post", postId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, title, body, image_url, created_at, tournament_id")
        .eq("id", postId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="p-4 md:p-12 max-w-2xl mx-auto">
      <Link
        to="/blog"
        className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : !post ? (
        <p className="mt-8 text-sm text-muted-foreground">Post not found.</p>
      ) : (
        <article className="mt-4">
          <header className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
              Blog Post
            </p>
            <h1 className="font-display text-3xl md:text-4xl uppercase mt-1 leading-tight">
              {post.title}
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              {new Date(post.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
            {isAdmin && (
              <Link
                to="/blog/$postId/edit"
                params={{ postId }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Link>
            )}
          </header>

          {post.image_url && (
            <img
              src={post.image_url}
              alt={post.title}
              className="w-full rounded-md border border-border mb-6"
            />
          )}

          <Card className="p-5 md:p-6">
            <div className="text-sm whitespace-pre-wrap leading-relaxed">
              {linkify(post.body ?? "")}
            </div>
          </Card>
        </article>
      )}
    </div>
  );
}
