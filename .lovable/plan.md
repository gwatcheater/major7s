## Problem

`www.major7s.com` renders a blank page for fresh / incognito visitors. The HTML and JS bundle return 200, but nothing mounts and no redirect occurs. Confirmed in a clean headless browser.

## Cause

`src/routes/index.tsx` defines only a `beforeLoad` (no `component`). It guards with `if (typeof window === "undefined") return;` and then reads the Supabase session to redirect to `/login` or `/home`.

During SSR the guard short-circuits, so the `/` match is sent to the client with no component. On hydration, TanStack Router reuses the SSR-resolved match and does not re-run `beforeLoad`, so the client never redirects — the user sees the blank shell. Browsers with an existing session only avoid this by navigating in from another route.

## Fix

Make the `/` route resolve the redirect on every client load.

Edit `src/routes/index.tsx`:

1. Keep the recovery-link handling in `beforeLoad` (it's a pure URL check, safe on SSR and client).
2. Remove the session check from `beforeLoad`.
3. Add `ssr: false` to the route so the match is always resolved on the client (no stale SSR match), OR add a `component` that performs the session check + `navigate({ to: "/login" | "/home", replace: true })` inside a `useEffect`, rendering a minimal loading state in the meantime.

Preferred: `ssr: false` + move the session/redirect logic into a small `component`. This keeps the redirect logic in one place and guarantees it runs on every fresh visit (including incognito).

## Verification

- Headless: `curl` + Playwright fresh context against `https://www.major7s.com` should redirect to `/login` and render the login page (body length > 1 KB, visible form).
- Manual: open `www.major7s.com` in a Chrome incognito window — expect the login screen, not a blank page.
- Logged-in: existing session in localStorage redirects to `/home` as before.

## Out of scope

No changes to auth, `/login`, `/home`, recovery flow, or any other route.
