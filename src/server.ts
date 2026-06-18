import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { isBotUserAgent } from "./lib/bot-user-agents";
import { renderOgHtml } from "./lib/og-html";
import { supabaseAdmin } from "./integrations/supabase/client.server";
import blogDefault from "./assets/blog-default.png.asset.json";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

// ---------------------------------------------------------------------------
// Bot OG shim — intercepts shareable page requests from link-unfurl scrapers
// and returns a minimal HTML page with populated Open Graph tags.
// Matches:
//   - /blog/<uuid>
//   - /tournament/<uuid>/blog/<uuid>
//   - /tournament/<uuid>
// This runs BEFORE TanStack Start processes the request, avoiding the SSR
// pipeline entirely (throwing a Response from a route loader does not work
// in TanStack Start on Cloudflare Workers).
// ---------------------------------------------------------------------------

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BLOG_POST_RE = new RegExp(
  `^(?:\\/tournament\\/${UUID})?\\/blog\\/(${UUID})$`,
  "i",
);
const TOURNAMENT_RE = new RegExp(
  `^\\/tournament\\/(${UUID})(?:\\/(leaderboard|lineup|stats))?$`,
  "i",
);

const SUBPAGE_LABELS: Record<string, string> = {
  leaderboard: "Leaderboard",
  lineup: "Lineup",
  stats: "Stats",
};

function stripMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~\-]+/g, " ")
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

function absoluteImageUrl(
  origin: string,
  imageUrl: string | null | undefined,
): string {
  if (!imageUrl) return `${origin}${blogDefault.url}`;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return `${origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

async function serveBotOgPage(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const m = BLOG_POST_RE.exec(url.pathname);
  if (!m) return null;

  const ua = request.headers.get("user-agent");
  if (!isBotUserAgent(ua)) return null;

  const postId = m[1];
  const origin = url.origin;

  let title = "Major7s";
  let description = "Pick smart. Tweak obsessively. Suffer beautifully.";
  let imageUrl = `${origin}/apple-touch-icon.png`;

  try {
    const { data } = await supabaseAdmin
      .from("blog_posts")
      .select("id, title, body, image_url")
      .eq("id", postId)
      .maybeSingle();

    if (data) {
      title = data.title ?? title;
      description = makeDescription(data.body);
      imageUrl = absoluteImageUrl(origin, data.image_url);
    }
  } catch (err) {
    console.error("[bot-og] Supabase error, using fallback meta", err);
  }

  return new Response(
    renderOgHtml({
      title,
      description,
      imageUrl,
      absoluteUrl: `${origin}${url.pathname}`,
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    },
  );
}

async function serveBotTournamentOgPage(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const m = TOURNAMENT_RE.exec(url.pathname);
  if (!m) return null;

  const ua = request.headers.get("user-agent");
  if (!isBotUserAgent(ua)) return null;

  const tournamentId = m[1];
  const origin = url.origin;

  let title = "Major7s";
  let description = "Pick smart. Tweak obsessively. Suffer beautifully.";
  let imageUrl = `${origin}/apple-touch-icon.png`;

  try {
    const { data } = await supabaseAdmin
      .from("tournaments")
      .select("id, name, location, start_date, logo_url")
      .eq("id", tournamentId)
      .maybeSingle();

    if (data) {
      const baseName = data.name ?? title;
      const year = data.start_date
        ? new Date(data.start_date).getFullYear()
        : null;
      const subpage = m[2] ? SUBPAGE_LABELS[m[2].toLowerCase()] : null;
      title = subpage ? `${baseName} ${year ?? ""} - ${subpage}`.trim() : baseName;
      const parts: string[] = [];
      if (data.location) parts.push(data.location);
      if (year) parts.push(String(year));
      description = parts.length
        ? `${baseName} — ${parts.join(", ")}. Major7s fantasy golf picks game.`
        : `${baseName} — Major7s fantasy golf picks game.`;
      if (data.logo_url) {
        imageUrl = /^https?:\/\//i.test(data.logo_url)
          ? data.logo_url
          : `${origin}${data.logo_url.startsWith("/") ? "" : "/"}${data.logo_url}`;
      }
    }
  } catch (err) {
    console.error("[bot-og] Supabase error, using fallback meta", err);
  }

  return new Response(
    renderOgHtml({
      title,
      description,
      imageUrl,
      absoluteUrl: `${origin}${url.pathname}`,
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    },
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const botResponse =
      (await serveBotOgPage(request)) ||
      (await serveBotTournamentOgPage(request));
    if (botResponse) return botResponse;

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
