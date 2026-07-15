# Blog Pipeline — Read-Only Investigation

## 1. Blog generation

**There is no existing blog-generation flow, no "Status 1 / Picks Closed Summary" handler, and no server function that returns `{ title, body }` to populate an editor form.** I searched for LLM calls, prompts, "generate", "writer", "summary", "openai/anthropic/gemini", `LOVABLE_API_KEY` usage, and admin buttons that produce blog copy. Findings:

- The only `LOVABLE_API_KEY` usages are inbound-webhook auth checks in `src/routes/lovable/email/**` (Lovable Emails infra), not an LLM call.
- `src/routes/_authenticated/admin.index.tsx` has a `setReport(...)` state block, but it is the **Bulk User Generation** result panel (`BulkImportTab`, lines 287–460), not a blog generator.
- The only `createServerFn`s that touch `blog_posts` are:
  - `getBlogPostMeta` in `src/lib/blog-post-meta.functions.ts` — returns OG meta `{ title, description, imageUrl }` for the public share route only (no body).
- The "Status 1" you may be remembering does not exist in code. The tournament status enum is `upcoming | open_for_picks | picks_closed | live | completed` (`src/integrations/supabase/types.ts:1051`, `admin.index.tsx:56`); there is no handler keyed on `picks_closed` that produces blog copy.
- One adjacent artifact: `public.tournaments.recap_blog TEXT` (migration `20260518153731_...sql:69`). It is a manually-editable free-text column with **no writer, no generator, no admin UI to edit it** (I could not find a form field or server fn that writes it). It is only read at `src/routes/_authenticated/tournament.$id.tsx:435` as a fallback string when a tournament has no blog posts.

**Prompt text / system prompt:** not found — none exists.

**Provider / model / key location:** not found — no LLM is wired up. The Lovable AI Gateway is available in this stack (`LOVABLE_API_KEY` secret is already present) but is not currently consumed by any code path.

## 2. `blog_posts` schema and lifecycle

Full DDL (`supabase/migrations/20260526135353_...sql`):

```sql
CREATE TABLE public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- **No drafts vs published distinction.** No status/published_at/slug columns. Every insert is immediately live to all authenticated readers.
- No slug. Routing is by `id` (uuid). `author_id` present (uuid, no FK declared in DDL). `tournament_id` optional FK to `tournaments` (`ON DELETE SET NULL`). `image_url` optional (points at the public `blog-images` Storage bucket). `updated_at` maintained by trigger `blog_posts_set_updated_at` → `public.set_updated_at()`.
- **No publish-time side effects.** No email trigger, no `pg_net`/webhook, no `pg_cron` job, no pgmq enqueue references `blog_posts`. Publishing is a plain `INSERT`.
- Indexes: `idx_blog_posts_tournament(tournament_id)`, `idx_blog_posts_created_at(created_at DESC)`.

RLS policies (all on `TO authenticated`, RLS enabled, no anon access):

```sql
"Blog: signed-in read"          SELECT USING (true)
"Blog: admin insert"            INSERT WITH CHECK (has_role(auth.uid(),'admin') AND author_id = auth.uid())
"Blog: author or admin update"  UPDATE USING/CHECK (author_id = auth.uid() OR has_role(auth.uid(),'admin'))
"Blog: author or admin delete"  DELETE USING (author_id = auth.uid() OR has_role(auth.uid(),'admin'))
```

Storage bucket `blog-images` is public-read, admin-only write/update/delete (same migration).

## 3. The blog editor

Two parallel editors (general + tournament-scoped), both hand-rolled, no form library:

- General create: `src/routes/_authenticated/blog.new.tsx` (`/blog/new`).
- General edit: `src/routes/_authenticated/blog.$postId.edit.tsx` (`/blog/$postId/edit`).
- Tournament create: `src/routes/_authenticated/tournament.$id.blog.new.tsx`.
- Tournament edit: `src/routes/_authenticated/tournament.$id.blog.$postId.edit.tsx`.

**Form library:** none — `useState` for `title`, `body`, `file`, `preview`, plus inline validation (`title.trim()`, MIME/size check on the image). No Zod on the client side. Errors surface via `sonner` `toast.error(...)`.

**How the (nonexistent) server-fn response would enter the form today:** there is no such flow. The form is populated in edit mode by a `useQuery` against `blog_posts` and a `useEffect` that seeds state from the row (`blog.$postId.edit.tsx:70–76`).

**Body format:** Markdown. It is rendered with `react-markdown` + `remark-gfm` inside a Tailwind `prose` container in:
- Public post view: `src/routes/blog.$postId.tsx` → `src/components/blog/blog-post-content.tsx` (`/blog/$postId`, auth-gated component but the route itself is public and pre-renders OG meta).
- Authenticated tournament-scoped view: `src/routes/_authenticated/tournament.$id.blog.$postId.index.tsx`.
- Authenticated list: `src/routes/_authenticated/blog.index.tsx` (`/blog`).

## 4. Admin access control

Roles are stored in `public.user_roles(user_id, role app_role)` with a `SECURITY DEFINER` check function `public.has_role(_user_id uuid, _role app_role)` (see db-functions in context).

**Client hook** (`src/hooks/use-auth.tsx:29–41`):

```ts
supabase.from("user_roles").select("role")
  .eq("user_id", s.user.id).eq("role", "admin").maybeSingle()
  .then(({ data }) => setIsAdmin(!!data));
```

`useAuth()` exposes `{ session, user, loading, isAdmin }`.

**Server-side** authorization for privileged server fns uses `assertAdmin(context)` inside handlers wrapped by `requireSupabaseAuth` middleware (see `src/lib/admin-users.functions.ts` — e.g. `setUserPassword`, `bulkCreateApprovedUsers`). RLS on `blog_posts` also enforces admin via `has_role(...)` in policies, so a non-admin cannot INSERT even with a forged client.

**Both** client and server checks exist. The client check is UX-only (hides UI); the RLS policies + `assertAdmin` are the real gate.

**Existing admin route gate** (`src/routes/_authenticated/admin.tsx`):

```tsx
beforeLoad: async () => {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) throw redirect({ to: "/login" });
  const { data } = await supabase.from("user_roles").select("role")
    .eq("user_id", sess.session.user.id).eq("role", "admin").maybeSingle();
  if (!data) throw redirect({ to: "/home" });
},
```

Runs client-side only (parent `_authenticated` layout is `ssr:false`). The admin console page itself (`admin.index.tsx:66–83`) also renders a "Restricted" alert if `!isAdmin` — belt-and-braces.

No hardcoded admin allowlist; admin is purely a `user_roles.role = 'admin'` row.

## 5. Sidebar navigation

File: `src/components/app-sidebar.tsx`.

Public nav is a flat array (`nav`, lines 10–17): Live & Upcoming, Blog, Event Archive, Global Stats, Hall of Fame, Rules.

**Admin item is a single inline link, no group heading**, appended after the main nav (lines 152–164):

```tsx
{isAdmin && (
  <Link to="/admin" className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors mt-4",
    path.startsWith("/admin") ? "font-bold" : "text-white/60 hover:text-white")}
    style={path.startsWith("/admin") ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}>
    <Shield className="size-3.5" />
    <span className="text-xs tracking-tight uppercase">Admin Panel</span>
  </Link>
)}
```

**Icons:** `lucide-react`, imported as named imports at the top of the file (`Trophy, Archive, BarChart3, Crown, Shield, LogOut, ChevronDown, AlertTriangle, Newspaper, BookOpen`).

## 6. Server function patterns

Representative example — `getBlogPostMeta` in `src/lib/blog-post-meta.functions.ts` (matches house style: `createServerFn` from `@tanstack/react-start`, Zod `.inputValidator`, then `.handler`; uses `supabaseAdmin` for a public safe-column read; helpers pulled from `@tanstack/react-start/server`):

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({ postId: z.string().uuid() });

export const getBlogPostMeta = createServerFn({ method: "GET" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<BlogPostMeta | null> => {
    return await fetchMeta(data.postId);
  });
```

Authenticated pattern (e.g. `setUserPassword`, `admin-users.functions.ts:125+`): adds `.middleware([requireSupabaseAuth])`, then `await assertAdmin(context)` at the top of the handler; on failure paths returns a discriminated union `{ ok: true, ... } | { ok: false, error: string }` rather than throwing (so a downstream email failure doesn't undo the primary action). Audit rows go into `public.admin_audit`.

**Call sites:** components use `const fn = useServerFn(serverFn); await fn({ data: ... })` (e.g. `admin.index.tsx:300`). Errors surface via `try/catch` → `toast.error(e?.message ?? "…")`.

**Loading state:** local `useState` `busy`/`saving` flag, `disabled` on the button, `Loader2` spinner from lucide.

**Long-running work:** there is no in-app queue for user-triggered work. The only queue is `pgmq` for outbound email (`q_auth_emails`, `q_transactional_emails`) drained by `pg_cron` job `process-email-queue` → `public.email_queue_dispatch()` → HTTP POST to `/lovable/email/queue/process`. There is no optimistic-UI pattern in the codebase for admin actions.

## 7. Historical records module

Lives in DB functions (see db-functions in context) plus the `owgr_*` and `player_id_xref` tables. Exposed RPCs:

- `golfer_major_stats(p_major, p_year_from, p_year_to, p_min_majors)` — per-player aggregates: majors_played, cuts_made, cut_pct, wins, top10s, top10_pct, best_finish, avg_finish, best_seed, avg_seed, total_points. Consumer: `src/components/MajorsStatsTable.tsx`.
- `golfer_major_history(p_owgr_player_id)` — one row per year/major with finish, made_cut, seed, points_won. Consumer: `src/components/GolferHistoryPanel.tsx`.
- `form_events()` / `form_matrix()` — recent-form table across `owgr_form_results`. Consumer: `src/components/RecentFormTable.tsx`.
- `current_field_player_ids()` — this event's field.

**Best/worst team score by major family / all-time?** Not directly. These RPCs are **per-golfer / per-player**, sourced from OWGR event results — not from Major7s team totals. Team totals are computed in code by `calculateMajor7sScores` inside `src/lib/espn-leaderboard.functions.ts` (best 5 of 7 pick scores, non-finisher = 100 pts) and persisted in `public.tournament_scores` / `public.tournament_score_picks` / `public.tournament_leaderboard`.

Closest existing query for "best/worst team score in a major family": no ready-made RPC. You would compose it against `tournament_scores` joined to `tournaments` (which carries `name`, `start_date`, and a status enum but **no explicit major-family column** — the family is currently only implicit in the tournament name). What's missing:

- A `major_type` column on `tournaments` (or a name-parsing view) so you can group by Masters/PGA/US Open/The Open.
- A view or RPC that returns MIN/MAX `total_points` per `tournament_id` from `tournament_scores`, filtered by that family, plus an all-majors variant.

## 8. Surprises and gotchas

- **No published/draft flag.** Every INSERT is instantly live to all signed-in users. Any generator that "drafts" a post needs a schema column (e.g. `status` or `published_at`), matching RLS, and index updates — none exist today.
- **Two parallel editor implementations** (general and tournament-scoped) with nearly identical code. Any UX change must be made in both. Same for the two viewer routes.
- **Public share route quirk:** `src/routes/blog.$postId.tsx` is a public SSR route that loads OG meta via `getBlogPostMeta` (uses `supabaseAdmin`), then the component itself gates rendering — signed-out users get redirected to `/login`. Bots are intercepted upstream in `src/server.ts`. This is fine but non-obvious: the "public" URL doesn't render the body to logged-out humans.
- **`recap_blog` on `tournaments`** is dead-ish code: a TEXT column with no writer UI, no generator, only a read fallback in `tournament.$id.tsx:435`. Easy to confuse with `blog_posts`.
- **`author_id` is `NOT NULL` with no FK declared in the migration** and no explicit index. `blog_posts` inserts hard-fail if `user.id` is missing (client relies on `useAuth().user`).
- **`ON DELETE SET NULL`** on `tournament_id`: if a tournament is deleted, its posts become "General" rather than being removed.
- **Storage path convention:** general posts upload to `general/<uuid>.<ext>`, tournament posts to `<tournament_id>/<uuid>.<ext>`. Edit form always uploads to `general/...` regardless of the post's tournament (`blog.$postId.edit.tsx:118`) — minor inconsistency.
- **RLS `SELECT USING (true)`** means every authenticated user reads every post. There is no per-team or per-tournament visibility.
- **`useAuth().isAdmin`** starts as `false` and is set asynchronously in `onAuthStateChange`; on hard refresh it can briefly be `false` before turning `true`, so gates that render "Only admins can…" copy will flicker. This is already visible in `blog.new.tsx:51` and `blog.$postId.edit.tsx:78`.
- **No AI dependency installed today.** Adding an LLM step will need a fresh decision on Lovable AI Gateway model + a `createServerFn` following the `admin-users.functions.ts` middleware/assertAdmin pattern.

## 9. File map

```
Editors & viewers (client)
  src/routes/_authenticated/blog.index.tsx                       — signed-in blog list (`/blog`), admin sees "New Post" button
  src/routes/_authenticated/blog.new.tsx                         — general create form (`/blog/new`), inline useState, sonner errors
  src/routes/_authenticated/blog.$postId.edit.tsx                — general edit + delete form (`/blog/$postId/edit`)
  src/routes/_authenticated/tournament.$id.blog.new.tsx          — tournament-scoped create
  src/routes/_authenticated/tournament.$id.blog.$postId.edit.tsx — tournament-scoped edit
  src/routes/_authenticated/tournament.$id.blog.$postId.index.tsx— tournament-scoped viewer
  src/routes/_authenticated/tournament.$id.tsx                   — tournament detail; renders `recap_blog` fallback when no posts
  src/routes/blog.$postId.tsx                                    — PUBLIC SSR share route (OG meta only); redirects unauth humans to /login
  src/components/blog/blog-post-content.tsx                      — shared react-markdown+remark-gfm renderer

Server functions & meta
  src/lib/blog-post-meta.functions.ts                            — getBlogPostMeta({ postId }) → { title, description, imageUrl } for OG tags
  src/assets/blog-default.png.asset.json                         — fallback OG/list image
  src/server.ts                                                  — bot detection layer that short-circuits /blog/* for crawlers

Nav & auth
  src/components/app-sidebar.tsx                                 — sidebar; conditional "Admin Panel" link under isAdmin
  src/hooks/use-auth.tsx                                         — AuthProvider + useAuth() (isAdmin via user_roles lookup)
  src/routes/_authenticated.tsx                                  — ssr:false auth gate for the whole authed subtree
  src/routes/_authenticated/admin.tsx                            — admin route gate (user_roles admin lookup)
  src/routes/_authenticated/admin.index.tsx                      — admin console; house style for server-fn calls, tabs, sonner errors

Storage & schema
  supabase/migrations/20260526135353_...sql                      — blog_posts table, RLS, indexes, blog-images bucket + storage policies
  supabase/migrations/20260526135415_...sql                      — supplemental blog-images storage policy
  supabase/migrations/20260518153731_...sql                      — tournaments.recap_blog TEXT column (unused writer path)
  src/integrations/supabase/types.ts                             — generated Row/Insert/Update types for blog_posts

Historical records (adjacent — used by lineup/stats, not the blog today)
  DB RPCs: golfer_major_stats, golfer_major_history, form_events, form_matrix, current_field_player_ids
  src/components/MajorsStatsTable.tsx / GolferHistoryPanel.tsx / RecentFormTable.tsx
  src/lib/espn-leaderboard.functions.ts                          — calculateMajor7sScores (best-5-of-7, team totals)
  Tables: owgr_event_results, owgr_form_results, player_id_xref, tournament_scores, tournament_score_picks, tournament_leaderboard
```
