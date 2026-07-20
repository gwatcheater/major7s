import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBlogEngagement } from "@/hooks/use-blog-engagement";
import { BlogEngagementBar } from "@/components/blog/blog-engagement-bar";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  postId: string;
}

export function BlogPostContent({ postId }: Props) {
  const { isAdmin } = useAuth();
  const engagement = useBlogEngagement(postId);

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
            <p
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "var(--gold)" }}
            >
              Blog Post
            </p>
            <h1 className="font-display text-3xl md:text-4xl mt-1 leading-tight">
              {post.title}
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              {new Date(post.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>

            <div className="mt-3">
              <BlogEngagementBar
                views={engagement.views}
                likes={engagement.likes}
                liked={engagement.liked}
                onToggleLike={engagement.toggleLike}
                pending={engagement.pending}
              />
            </div>

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
            <div className="w-full aspect-[16/9] overflow-hidden rounded-xl shadow-sm mb-8">
              <img
                src={post.image_url}
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <Card className="p-5 md:p-6">
            <div className="prose prose-slate max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {post.body ?? ""}
              </ReactMarkdown>
            </div>
          </Card>

          <div className="mt-6 pt-4 border-t border-border">
            <BlogEngagementBar
              views={engagement.views}
              likes={engagement.likes}
              liked={engagement.liked}
              onToggleLike={engagement.toggleLike}
              pending={engagement.pending}
            />
          </div>
        </article>
      )}
    </div>
  );
}
