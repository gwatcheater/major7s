## Overhaul Tournament Detail View

Refactor `src/routes/_authenticated/tournament.$id.tsx` into a dashboard-style layout matching the new spec. No schema changes — uses existing `tournaments`, `golfers`, `picks`, `profiles`, `teams` tables.

### 1. Data fetching
In addition to the current `tournaments` query, fetch in parallel:
- Active team's `picks` for this tournament (join to `golfers` for `golfer_name`) — keyed `["picks", teamId, tournamentId]`.
- Current user's `profiles` row to read `team_nickname` (used as the leaderboard display handle).

Compute `submittedAt` = max(`last_edited_at`) across the 7 picks; `hasPicks` = picks.length === 7.

### 2. Header panel
Replace the simple `<h1>` block with a responsive flex header:
- Left: logo `<img src={tournament.logo_url}>` (fallback placeholder div if null) + tournament name (`font-display`, large).
- Below name: location row with `MapPin` icon + `tournament.location`; date row with `Calendar` icon + `tournamentDateRange(start_date, end_date)` (already in `src/lib/format.ts`).
- Right: status badge. Build a `statusMeta(status)` helper mapping each `tournament_status` enum value to `{ label, className }` using semantic tokens (e.g. `bg-primary/15 text-primary` for open_for_picks, muted for upcoming, destructive for picks_closed, etc.). No raw hex.

### 3. Picks card
Bordered `Card` wrapper:
- Header row: `Clipboard` icon + "Picks" title, two Badges (tournament status, submission state: red "Not Entered" / green "Picks Submitted").
- Top-right meta: when `hasPicks`, show "Submitted: {formatted submittedAt}" and a green `CheckCircle2` next to "Your Team — {profile.team_nickname}".
- Body: 7-row stack (Bucket 1..7). Left: bucket number chip; right: golfer name or em-dash. Map picks by `bucket` for O(1) lookup.
- Empty state: when no picks, hide the grid and show a prominent `Link` button to `/tournament/$id/lineup` labeled "Submit Team Lineup" (reuse forest-deep styling). Disable/relabel when status not `open_for_picks` or deadline passed.

### 4. Navigation accordion grid
Below the picks card, render a vertical stack (`grid grid-cols-1 md:grid-cols-3 gap-3`) of three uniform clickable cards:
- Leaderboard — `Trophy` icon, `Link` to `/tournament/$id` standings (route does not yet exist — link to `/tournament/$id` for now and add a TODO comment; or use the existing stats route `/stats`). Will use `/stats` as the destination since no per-tournament leaderboard route exists.
- Statistics — `BarChart3` icon + muted subtext "Pick stats & fun facts — Tap to view", links to `/stats`.
- Blog — `FileText` icon. Uses a shadcn `Collapsible` to expand and show `tournament.recap_blog` (or "No recap yet" placeholder) inline.

Each card: left icon, label + optional subtext, trailing `ChevronRight` (rotates 90° when Blog collapsible is open).

### 5. Cleanup
Remove the old "Registration Closes In" panel and the standalone Recap section (now folded into the Blog accordion). Keep the `← Feed` back-link and the lineup `Outlet` passthrough for `/lineup`.

### Technical details
- New imports: `MapPin, Calendar, Clipboard, CheckCircle2, Trophy, BarChart3, FileText, ChevronRight` from `lucide-react`; `Card`, `Badge`, `Collapsible/Trigger/Content` from `@/components/ui/*`; `useTeams` hook; `tournamentDateRange` from `@/lib/format`.
- All colors via semantic tokens (`bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, `bg-destructive`, `text-green-600` allowed only via existing `--success`-style token if present; otherwise add a `--success` token to `src/styles.css`).
- Keep mobile-first responsive: header stacks under `sm:`, accordion grid is single-column on mobile.
- No DB migrations, no changes to lineup picker or other routes.
