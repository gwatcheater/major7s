import { Eye, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

// Save as: src/components/blog/blog-engagement-bar.tsx
//
// View count + like button, meant to be rendered once near the top of a
// post and again after the body. Pass the same values/handler both times.

interface Props {
  views: number;
  likes: number;
  liked: boolean;
  onToggleLike: () => void;
  pending?: boolean;
}

export function BlogEngagementBar({ views, likes, liked, onToggleLike, pending }: Props) {
  return (
    <div className="flex items-center gap-4 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5" title={`${views.toLocaleString()} views`}>
        <Eye className="w-4 h-4" />
        {views.toLocaleString()} {views === 1 ? "view" : "views"}
      </span>
      <button
        type="button"
        onClick={onToggleLike}
        disabled={pending}
        aria-pressed={liked}
        aria-label={liked ? "Unlike this post" : "Like this post"}
        className={cn(
          "inline-flex items-center gap-1.5 transition-colors",
          liked ? "text-red-500" : "hover:text-foreground",
          pending && "opacity-60 cursor-wait",
        )}
      >
        <Heart
          className={cn("w-4 h-4 transition-transform", liked && "fill-current scale-110")}
        />
        {likes.toLocaleString()}
      </button>
    </div>
  );
}
