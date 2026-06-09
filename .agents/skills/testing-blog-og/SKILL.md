---
name: testing-blog-og
description: Test the blog post OG meta tag shim that serves link-unfurl bots (WhatsApp, Facebook, Twitter, etc.) with minimal OG HTML. Use when verifying bot detection, OG tag rendering, or auth redirect flows on blog post routes.
---

# Testing Blog OG Bot Detection

## Overview

Blog posts at `/blog/<uuid>` use a "secret trapdoor" pattern:
- **Bot UA** (WhatsApp, Facebook, Twitter, etc.) → minimal OG-only HTML (no React app)
- **Human UA, logged in** → full blog post content
- **Human UA, logged out** → redirect to `/login?redirect=/blog/<uuid>`

Bot detection runs in `src/server.ts` (Cloudflare Workers entry point), before TanStack Start processes the request. This is critical — TanStack Start route loaders cannot `throw Response` on Cloudflare Workers.

## Local Dev Setup

```bash
npm run dev  # Starts on http://localhost:8080
```

The local dev server uses `server.ts` as entry (configured in `vite.config.ts` via `tanstackStart.server.entry`). Bot interception works locally.

**Known limitation:** `SUPABASE_SERVICE_ROLE_KEY` is not available locally. The bot path falls back to generic meta values (title: "Major7s", description: "Pick smart..."). Post-specific metadata (real title/description/image) can only be tested in production.

## Curl-Based Bot Tests

### Core: Bot UA returns OG HTML
```bash
curl -s -D- -H "User-Agent: WhatsApp/2.23.20.0" \
  "http://localhost:8080/blog/00000000-0000-0000-0000-000000000000"
```
Expect: HTTP 200, `cache-control: public, max-age=300`, minimal HTML with `og:title`, `og:description`, `og:image`, `og:url`, zero `<script>` tags, body < 1KB.

### Multiple bot UAs
```bash
for UA in "facebookexternalhit/1.1" "Twitterbot/1.0" "LinkedInBot/1.0" "Discordbot/2.0" "Slackbot-LinkExpanding 1.0"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "User-Agent: $UA" \
    "http://localhost:8080/blog/00000000-0000-0000-0000-000000000000")
  echo "$UA → HTTP $STATUS"
done
```
Expect: All return HTTP 200.

### Negative: Normal browser UA NOT intercepted
```bash
curl -s -w "%{http_code}" -H "User-Agent: Mozilla/5.0 Chrome/120.0.0.0" \
  "http://localhost:8080/blog/00000000-0000-0000-0000-000000000000"
```
Expect: NOT 200 with OG HTML. Body should contain `<script>` tags (full SPA).

### Negative: Non-UUID path NOT intercepted
```bash
curl -s -w "%{http_code}" -o /dev/null -H "User-Agent: WhatsApp/2.23.20.0" \
  "http://localhost:8080/blog/not-a-uuid"
```
Expect: Not matched by UUID regex.

## Post-Deploy Verification

After merging and deploying to production:
```bash
# Should return 200 with post-specific OG tags
curl -s -H "User-Agent: WhatsApp/2.23.20.0" \
  "https://www.major7s.com/blog/<real-post-uuid>"
```
Verify: `og:title` contains the actual post title, `og:image` is the post's featured image or the blog-default fallback.

## Key Files

- `src/server.ts` — Bot interception logic (`serveBotOgPage()`)
- `src/lib/bot-user-agents.ts` — Bot UA regex pattern
- `src/lib/og-html.ts` — Minimal OG HTML template renderer
- `src/routes/blog.$postId.tsx` — Public blog route (human path only)
- `src/lib/blog-post-meta.functions.ts` — Server function for post metadata
- `src/integrations/supabase/client.server.ts` — Admin Supabase client (needs `SUPABASE_SERVICE_ROLE_KEY`)

## Devin Secrets Needed

- `MAJOR7S_ADMIN_EMAIL` — Admin login email for browser auth flow testing
- `MAJOR7S_ADMIN_PASSWORD` — Admin login password
- `SUPABASE_SERVICE_ROLE_KEY` — Not currently available; needed for testing post-specific OG metadata locally
