## Goal

WhatsApp, Facebook, Twitter, LinkedIn, Slack and other link-unfurlers must receive populated Open Graph tags for `/blog/$postId` without going through Supabase auth. Real users keep the existing authenticated experience.

## Approach: "Secret Trapdoor" on the existing URL

Move `/blog/$postId` out from under `_authenticated`, replace it with a single public route that branches on the request's `User-Agent`:

```text
GET /blog/{id}
  │
  ├─ User-Agent matches scraper regex ──► return raw HTML with <meta og:*> only (200)
  │
  └─ Real browser (SSR pass)
        │
        └─ Render shell with OG tags in <head> + loading placeholder
              │
              └─ On client hydrate:
                    ├─ signed in  ──► fetch + render full post (existing UI)
                    └─ signed out ──► redirect("/login", { redirect: "/blog/{id}" })
```

URLs already shared on WhatsApp keep working — no migration needed.

## What to build

### 1. Public meta server fn — `src/lib/blog-post-meta.functions.ts`
- `createServerFn({ method: "GET" })` with Zod `inputValidator({ postId: z.string().uuid() })`.
- Uses `supabaseAdmin` from `@/integrations/supabase/client.server` (bypasses RLS — safe because it returns ONLY `id`, `title`, `body` truncated, `image_url`, `created_at`).
- Returns `{ title, description, imageUrl, createdAt } | null`.
- `description` = first 150 chars of post body with markdown stripped, trimmed at word boundary, "…" appended.
- `imageUrl` falls back to the absolute URL of `src/assets/blog-default.png` (imported so Vite gives us its hashed URL) when `image_url` is empty.
- All URLs are made absolute against `getRequestHost()` + `x-forwarded-proto` (works for preview, prod, custom domain — no hardcoded host).

### 2. New public page route — `src/routes/blog.$postId.tsx`
- `createFileRoute("/blog/$postId")` — top-level, NOT inside `_authenticated`.
- `ssr: true` (default).
- `loader({ params })`:
  1. Call a `createServerOnlyFn` helper `handleBlogPostRequest(postId)` that:
     - reads `getRequestHeader("user-agent")`,
     - if it matches the bot regex (see §4), fetches meta via admin client and **throws** `new Response(renderOgHtml(meta), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } })` — TanStack short-circuits the render.
     - otherwise returns `{ meta }` for the human render path.
  2. Returns `{ meta, postId }`.
- `head({ loaderData, params })`: emits `<title>`, `description`, `og:title`, `og:description`, `og:image`, `og:url`, `og:type=article`, `twitter:card=summary_large_image`, `twitter:title/description/image`, and a `<link rel="canonical">` to `https://www.major7s.com/blog/{postId}`. Falls back to generic site copy if `meta` is null (deleted post).
- `component: PublicBlogPostRoute`:
  - Uses `useAuth()`. While `loading` → render a skeleton with the same `<h1>` title from `meta` (so OG isn't the only paint).
  - Not signed in → `<Navigate to="/login" search={{ redirect: \`/blog/${postId}\` }} replace />`.
  - Signed in → render the existing post UI (lift JSX out of the old authenticated file into a `<BlogPostContent postId={postId} />` component that runs the same `useQuery` against `blog_posts` with the user's session — RLS still applies, so this is unchanged behavior).
- `errorComponent` / `notFoundComponent` reuse the root patterns.

### 3. Delete the old gated route
- Remove `src/routes/_authenticated/blog.$postId.index.tsx`. Its sole consumer is the new public route, which renders the same content for signed-in users.
- The tournament variant `_authenticated/tournament.$id.blog.$postId.index.tsx` is **out of scope** for this task (different URL, different sharing pattern) and stays put. Flag for a follow-up if WhatsApp previews are wanted there too.

### 4. Bot-detection regex
Single case-insensitive regex covering the unfurlers that matter (kept in `src/lib/bot-user-agents.ts` so it's reusable and testable):

```text
facebookexternalhit | Facebot | Twitterbot | LinkedInBot | Slackbot | Slack-ImgProxy |
WhatsApp | Discordbot | TelegramBot | Pinterest | redditbot | Applebot |
SkypeUriPreview | vkShare | W3C_Validator | Googlebot | bingbot | DuckDuckBot |
embedly | quora link preview | Iframely | Mastodon | nuzzel
```

### 5. OG-only HTML template
A tiny string template (no React renderToString needed — keeps the response under 2 KB and avoids dragging React into the shim path):

```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>{{title}}</title>
<meta name="description" content="{{description}}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Major7s">
<meta property="og:title" content="{{title}}">
<meta property="og:description" content="{{description}}">
<meta property="og:image" content="{{imageUrl}}">
<meta property="og:url" content="{{absoluteUrl}}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{title}}">
<meta name="twitter:description" content="{{description}}">
<meta name="twitter:image" content="{{imageUrl}}">
<link rel="canonical" href="{{absoluteUrl}}">
</head><body><p>{{title}}</p></body></html>
```

All `{{…}}` values are HTML-escaped before interpolation.

## Files touched

| File | Action |
| --- | --- |
| `src/lib/blog-post-meta.functions.ts` | **new** — admin-side meta fetch + absolute-URL helper |
| `src/lib/bot-user-agents.ts` | **new** — regex + `isBotUserAgent(ua)` |
| `src/lib/og-html.ts` | **new** — `renderOgHtml(meta, absoluteUrl)` template + escaper |
| `src/routes/blog.$postId.tsx` | **new** — public route with loader, head(), component |
| `src/components/blog/blog-post-content.tsx` | **new** — extracted authed render of post body (same UI as today) |
| `src/routes/_authenticated/blog.$postId.index.tsx` | **delete** |
| `src/routes/_authenticated/blog.$postId.edit.tsx` | keep — the `/blog/$postId/edit` URL stays gated |
| `src/routeTree.gen.ts` | auto-regenerated by the Vite plugin |

## Security notes

- `supabaseAdmin` is only used to read the four meta fields needed for unfurls — never the full body — and only on the server. There's no path that returns body content to an anonymous human; the client component still calls the RLS-protected `blog_posts` query with the user's session.
- The bot branch returns a 200 with `Cache-Control: public, max-age=300` so scrapers don't hammer the database.
- The `redirect` param appended on the signed-out path is a same-origin relative URL (`/blog/{postId}`), matching how login already handles `search.redirect`.

## Verification

1. `curl -A "WhatsApp/2.23 (iPhone)" https://www.major7s.com/blog/<real-id>` → response is the OG-only HTML, `og:title`/`og:image` populated.
2. `curl -A "facebookexternalhit/1.1" …` → same.
3. Open the same URL in a logged-out browser → lands on `/login?redirect=/blog/<id>`. After signing in → redirected straight to the post.
4. Open the same URL in a logged-in browser → full post renders, no flash of login page.
5. Paste the prod URL into WhatsApp → preview card shows the post title, summary, and image.
