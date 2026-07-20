import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { BlogPostContent } from "@/components/blog/blog-post-content";
import { getBlogPostMeta } from "@/lib/blog-post-meta.functions";

export const Route = createFileRoute("/blog/$postId")({
  // Bot requests are intercepted in server.ts before reaching here.
  // This loader only runs for real browsers — it fetches post meta so
  // head() can emit OG/Twitter tags into the SSR HTML.
  loader: async ({ params }) => {
    const meta = await getBlogPostMeta({ data: { postId: params.postId } });
    return { meta };
  },
  head: ({ loaderData, params }) => {
    const meta = loaderData?.meta;
    const canonical = `https://www.major7s.com/blog/${params.postId}`;
    const title = meta?.title ? `${meta.title} — Major7s` : "Major7s";
    const description =
      meta?.description ??
      "Pick smart. Tweak obsessively. Suffer beautifully.";
    const image =
      meta?.imageUrl ?? "https://www.major7s.com/apple-touch-icon.png";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: "Major7s" },
        { property: "og:title", content: meta?.title ?? "Major7s" },
        { property: "og:description", content: description },
        { property: "og:image", content: image },
        { property: "og:url", content: canonical },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: meta?.title ?? "Major7s" },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: PublicBlogPostRoute,
});

function PublicBlogPostRoute() {
  const { postId } = Route.useParams();
  const { meta } = Route.useLoaderData();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="p-4 md:p-12 max-w-2xl mx-auto">
        {meta?.title && (
          <h1 className="font-display text-3xl md:text-4xl mt-1 leading-tight">
            {meta.title}
          </h1>
        )}
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        search={{ redirect: `/blog/${postId}` }}
        replace
      />
    );
  }

  return <BlogPostContent postId={postId} />;
}
