import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Save as: src/hooks/use-blog-engagement.ts
//
// Tracks a unique per-user view (once) and lets the current user like /
// unlike a post. Relies on two new tables — blog_post_views and
// blog_post_likes — plus views_count/likes_count columns on blog_posts,
// all maintained by DB triggers. See the accompanying SQL migration.

interface EngagementCounts {
  views_count: number | null;
  likes_count: number | null;
}

export function useBlogEngagement(postId: string) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  // Record a unique view for this user. The unique(post_id, user_id)
  // constraint + ignoreDuplicates means this is a no-op after the first
  // successful insert for a given user/post pair — no double counting on
  // refresh or re-render.
  useEffect(() => {
    if (!postId || !userId) return;
    let cancelled = false;

    supabase
      .from("blog_post_views")
      .upsert(
        { post_id: postId, user_id: userId },
        { onConflict: "post_id,user_id", ignoreDuplicates: true },
      )
      .then(({ error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[blog] failed to record view", error);
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["blog_post_counts", postId] });
      });

    return () => {
      cancelled = true;
    };
  }, [postId, userId, queryClient]);

  const countsQ = useQuery<EngagementCounts>({
    queryKey: ["blog_post_counts", postId],
    enabled: !!postId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("views_count, likes_count")
        .eq("id", postId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const likedQ = useQuery<boolean>({
    queryKey: ["blog_post_liked", postId, userId],
    enabled: !!postId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_post_likes")
        .select("post_id")
        .eq("post_id", postId)
        .eq("user_id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  const toggleLike = useCallback(async () => {
    if (!userId || pending) return;
    setPending(true);
    const wasLiked = likedQ.data ?? false;

    // Optimistic update so the heart responds instantly.
    queryClient.setQueryData(["blog_post_liked", postId, userId], !wasLiked);
    queryClient.setQueryData(
      ["blog_post_counts", postId],
      (old?: EngagementCounts) =>
        old
          ? {
              ...old,
              likes_count: Math.max(0, (old.likes_count ?? 0) + (wasLiked ? -1 : 1)),
            }
          : old,
    );

    const { error } = wasLiked
      ? await supabase
          .from("blog_post_likes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", userId)
      : await supabase.from("blog_post_likes").insert({ post_id: postId, user_id: userId });

    if (error) {
      console.error("[blog] failed to toggle like", error);
      // Revert to server truth on failure.
      queryClient.invalidateQueries({ queryKey: ["blog_post_liked", postId, userId] });
      queryClient.invalidateQueries({ queryKey: ["blog_post_counts", postId] });
    } else {
      queryClient.invalidateQueries({ queryKey: ["blog_post_counts", postId] });
    }
    setPending(false);
  }, [userId, pending, likedQ.data, postId, queryClient]);

  return {
    views: countsQ.data?.views_count ?? 0,
    likes: countsQ.data?.likes_count ?? 0,
    liked: likedQ.data ?? false,
    toggleLike,
    pending,
  };
}
