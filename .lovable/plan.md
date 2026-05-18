# Major7s — Build Plan

A premium golf-picks game engine for the 4 Majors. Lovable Cloud powers auth, database, and server-evaluated deadline locks. UI follows the selected **Broadcast Hybrid** direction (forest green, gold, white; Archivo Black display + Inter body + JetBrains Mono for countdowns/data), refined toward high-fashion whitespace.

## Architecture

- **Backend**: Lovable Cloud (Postgres + Auth + server functions). Server-evaluated `is_locked` so deadline cutoffs can't be bypassed client-side. RLS on every user table. Admin role via separate `user_roles` table (never on profile).
- **Frontend**: TanStack Start, sticky sidebar shell, route per major section. Active team profile stored in a global context + localStorage; switching it re-queries data and updates all views instantly (no refresh). Live countdowns tick via a single `useNow()` 1Hz hook shared across all cards.
- **Seed**: Empty. All tournaments, golfers, and field lists are created via the Admin Panel.

## Data model (Lovable Cloud)

- `profiles` — parent account (user_id, nickname, status: pending/approved)
- `user_roles` — (user_id, role: 'admin' | 'user')
- `teams` — game profiles owned by a parent account (id, owner_user_id, nickname, is_primary). Secondary teams auto-named `{primary_nickname} 2`.
- `tournaments` — (id, name, course, logo_url, start_date, end_date, lock_at, status: upcoming|open|locked|live|completed, recap_blog)
- `golfers` — normalized master (id, standard_name, owgr_rank, aliases jsonb)
- `tournament_field` — (tournament_id, golfer_id, owgr_bucket 1–7)
- `picks` — (tournament_id, team_id, bucket, golfer_id, submitted_at, last_edited_at, tweak_count)
- `owgr_snapshots` — global rank uploads
- `pending_signups` — admin gatekeeper queue

Server functions enforce: `is_locked = now() >= lock_at AND NOT caller_is_admin_or_impersonating`.

## Phase 1 — Cloud + Shell + Auth

- Enable Lovable Cloud, configure email + Google auth.
- Create schema + RLS policies + `has_role()` security-definer function.
- App shell: sticky left sidebar (logo, Active Team switcher with missing-picks alert, nav, User/Admin toggle, profile footer).
- Routes scaffolded: `/` (Live & Upcoming), `/archive`, `/stats`, `/hall-of-fame`, `/admin`, `/tournament/$id`, `/tournament/$id/lineup`, `/login`.
- Global `ActiveTeamContext` + team switcher. Admin gatekeeper approval flow.

## Phase 2 — Tournament Feed + Lineup Picker

- Landing Feed cards (logo, name, date, course, status badge, roster status badge contextual to active team).
- Live ticking countdown timer (`Xd Xh Xm Xs`) for Open-for-Picks cards via shared 1Hz tick.
- Card routing: Open → `/tournament/$id/lineup`; Locked/Live/Completed → Tournament Hub.
- Lineup Picker: 7 dropdowns grouped by OWGR bucket, pulled from `tournament_field`. Saves map to active team, set timestamps, increment tweak_count, flip card badge to Picks Selected. Disabled when server reports locked.
- Tournament Hub View (locked/live/completed): metadata, leaderboard placeholder, recap blog feed.

## Phase 3 — Admin Panel

- Tournament CRUD with Lock Cutoff datetime picker.
- Two-step Field Entry: CSV/manual add → normalization through alias map → auto-bucket from OWGR → Pre-Commit Staging Review with reassignment → **Commit Field List** → success modal prompts "Open for picks now?" (one-click status flip).
- Lock-Clock engine: server fn evaluates `lock_at` on every pick mutation; admin override flag bypasses.
- Admin overrides on any user's picks; force-submit/clear/edit.
- User Gatekeeper dashboard (approve pending signups).
- Impersonation Mode: "Act As User" dropdown sets impersonation context; team switcher then shows that user's teams; all writes audit-logged.
- Global OWGR Master Uploader (bulk CSV paste / inline edit).
- Normalized Golfer Database manager (add aliases, merge duplicates).

## Phase 4 — Archive, STATS, Hall of Fame

- **Archive**: searchable grid of completed tournaments with Entered/Did Not Enter badge for active team.
- **Finalised Event Summary**: active team roster telemetry (7 picks, timestamps, tweak count); final standings + optimal retrospective 7-player lineup; pinned recap blog; analytics grid — Most Popular Picks (sort by picks/OWGR), Unique Picks, Off-the-Wall Team, Popular Combinations (duos/trios/quads/quints with text search builder), Identical Teams Tracker, submission velocity accolades.
- **STATS**: Tab A Individual (active team scoped) — performance line chart, KPI blocks, Pick Category Efficiency, Roster Selection History. Tab B Community — OWGR bucket bar charts, course performance matrix.
- **Hall of Fame**: All-Time Leaderboard, Grand Slam Tracker (nested sort + Grand Slam Star), Wooden Spoons Wall of Shame. Each team profile = its own row.

## Technical notes (for the developer)

- Countdowns: one provider running `setInterval(1000)`, broadcasting `now` via context — avoids N independent timers per card.
- Server fn `getTournamentStatus(id)` returns canonical `is_locked` from server clock; client uses it as truth.
- Active team context switch invalidates React Query keys keyed by `team_id` so all charts/tables refetch without page reload.
- Combination analytics computed in SQL with `array_agg(golfer_id ORDER BY ...)` + grouping; trios/quads/quints via generated combos in a server fn with memoization.
- Charts: Recharts (already common); mobile-responsive via container queries.
- CSV parsing: papaparse in admin views; normalization runs each name through `golfers.aliases` lookup with fuzzy fallback.

## Out of scope for first build

- Real OWGR/ESPN feed integration (admin uploads CSV instead).
- Payments / season earnings — display-only mock for now unless requested.
- Email notifications for missing picks (in-app alert only).

Ready to enable Cloud and start Phase 1 on approval.
