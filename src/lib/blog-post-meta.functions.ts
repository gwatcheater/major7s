import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  getRequestHost,
} from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import blogDefault from "@/assets/blog-default.png.asset.json";
import { isBotUserAgent } from "@/lib/bot-user-agents";
import { renderOgHtml } from "@/lib/og-html";

export interface BlogPostMeta {
  title: string;
  description: string;
  imageUrl: string;
}

function stripMarkdown(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/[#>*_~\-]+/g, " ") // formatting chars
    .replace(/\s+/g, " ")
    .trim();
}

function makeDescription(body: string | null | undefined): string {
  const clean = stripMarkdown(body ?? "");
  if (!clean) return "Read the latest from Major7s.";
  if (clean.length <= 150) return clean;
  const slice = clean.slice(0, 150);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace > 100 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.replace(/[.,;:!?-]+$/, "")}…`;
}

function getOrigin(): string {
  const proto =
    getRequestHeader("x-forwarded-proto") ??
    getRequestHeader("X-Forwarded-Proto") ??
    "https";
  const host = getRequestHost();
  return `${proto}://${host}`;
}

function absolutize(origin: string, url: string | null | undefined): string {
  if (!url) return `${origin}${blogDefault.url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function fetchMeta(postId: string): Promise<BlogPostMeta | null> {
  const { data, error } = await supabaseAdmin
    .from("blog_posts")
    .select("id, title, body, image_url")
    .eq("id", postId)
    .maybeSingle();
  if (error) {
    console.error("[blog-post-meta] fetch error", error);
    return null;
  }
  if (!data) return null;
  const origin = getOrigin();
  return {
    title: data.title ?? "Major7s",
    description: makeDescription(data.body),
    imageUrl: absolutize(origin, data.image_url),
  };
}

const InputSchema = z.object({ postId: z.string().uuid() });

/**
 * Public meta fetch used by the route loader. Returns OG-friendly fields
 * only — never the full post body. Safe to expose to anonymous SSR because
 * the response payload is the same data we already feed to link-unfurl bots.
 */
export const getBlogPostMeta = createServerFn({ method: "GET" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<BlogPostMeta | null> => {
    return await fetchMeta(data.postId);
  });

/**
 * Loader helper that branches on User-Agent. Bots get an OG-only HTML
 * response (thrown as a Response so TanStack short-circuits rendering).
 * Everyone else gets the meta payload for the page <head>.
 */
export const resolveBlogPostRequest = createServerFn({ method: "GET" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ meta: BlogPostMeta | null }> => {
    const ua = getRequestHeader("user-agent") ?? getRequestHeader("User-Agent");
    const meta = await fetchMeta(data.postId);

    if (isBotUserAgent(ua)) {
      const origin = getOrigin();
      const absoluteUrl = `${origin}/blog/${data.postId}`;
      const html = renderOgHtml({
        title: meta?.title ?? "Major7s",
        description:
          meta?.description ??
          "Pick smart. Tweak obsessively. Suffer beautifully.",
        imageUrl: meta?.imageUrl ?? `${origin}${blogDefault.url}`,
        absoluteUrl,
      });
      throw new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    return { meta };
  });
