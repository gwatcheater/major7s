## Goal

Create a new tournament-specific statistics page at `/tournament/$id/stats` that pulls data only for that tournament from existing tables. Visible only when the tournament status is `picks_closed`, `live`, or `completed`.

## New route

`src/routes/_authenticated/tournament.$id.stats.tsx` — `createFileRoute("/_authenticated/tournament/$id/stats")`.

Mobile-first single scrollable page using existing shadcn components (`Card`, `Badge`, `Button`, `Progress`, `Skeleton`, `Collapsible`) and existing color tokens / `var(--forest-deep)` for the primary green. No new design system.

## Entry points (tournament cards)

- `src/routes/_authenticated/tournament.$id.tsx` — replace the current "Statistics" nav row (which links to `/stats`) with a link to `/tournament/$id/stats`, rendered only when `t.status ∈ {picks_closed, live, completed}`.
- `src/routes/_authenticated/home.tsx` and `archive.tsx` tournament cards — add a small "Stats" link/button shown under the same status condition. (All other card behavior unchanged.)

The all-time `/stats` page stays as-is.

## Data sources (existing tables only)

- `tournaments` — get `submission_deadline`, `status`, `name` for the header + Fastest/Late timing baseline (used as "picks opened" fallback baseline if no explicit open time column exists — noted in code comment for adjustment).
- `picks` — `team_id, bucket, golfer_id, submitted_at, last_edited_at, tweak_count` filtered by `tournament_id`.
- `golfers` — `id, golfer_name, owgr_rank` filtered by `tournament_id`.
- `teams` — `id, nickname` for all teams referenced.

One React Query per table, all scoped by `tournament_id`. All aggregation done client-side via `useMemo`.

## Sections

1. **Most Popular Picks** — flatten all picks, count per `golfer_id`, join golfer name + OWGR. Toggle `By picks | By ranking` using shadcn `Button` (active = `default`, inactive = `outline`). Each row: rank, name, OWGR badge (`Badge variant="secondary"`), 5px progress bar (`bg-muted` track, `var(--forest-deep)` fill, width = count / topCount), count + percentage right-aligned. Show top 10; `Collapsible` "Show all N golfers" reveals the rest.

2. **Unique Picks** — golfers with exactly one occurrence across all picks. Row: golfer name, team nickname, bucket.

3. **Popular Combinations** — four subsections (top 2/3/4/5). For each team build sorted set of its 7 picked golfer_ids; enumerate all C(7,k) subsets, count occurrences, take the max-count combination(s), show up to 3 ties. Display golfer names + team count + team nicknames sharing it.

4. **Identical Teams** — group teams by the canonical sorted-tuple of their 7 picks; list any group with size ≥ 2. Friendly empty state otherwise.

5. **Fun Facts** — three `Card`s side-by-side on desktop, stacked on mobile:
   - Fastest entry: team with min `submitted_at`; show delta vs `tournaments.submission_deadline` open time (comment notes the assumption since no explicit open time exists).
   - Leaving it late: team with max `submitted_at` before `submission_deadline`.
   - Tweaker: team with max `tweak_count` (aggregated across their picks).

## States

- `Skeleton` placeholders while any query loads.
- Error state with retry (calls `refetch`) using existing `Card` + muted text.
- Empty states ("No picks yet", "No identical teams") inline per section.

## Responsiveness

Container `max-w-5xl mx-auto p-4 md:p-8`. Sections stack vertically. Fun Facts use `grid grid-cols-1 md:grid-cols-3`. Long lists scroll within page (no inner scroll).

## Out of scope

No new tables, RPCs, edge functions, migrations, or design tokens. No edits to the all-time `/stats` page. Read-only.

## Files touched

- NEW `src/routes/_authenticated/tournament.$id.stats.tsx`
- EDIT `src/routes/_authenticated/tournament.$id.tsx` (swap Statistics link target + gate by status)
- EDIT `src/routes/_authenticated/home.tsx` (add gated Stats link on card)
- EDIT `src/routes/_authenticated/archive.tsx` (add gated Stats link on card)
