## Scope

Two files change:
- `src/routes/_authenticated/tournament.$id.tsx` — header polish, picks card refactor, vertical nav rows, edit button.
- `src/routes/_authenticated/tournament.$id.lineup.tsx` — tweak counter fix across all 7 buckets.

No DB migration. Schema stays one row per (team, tournament, bucket) — the requested `bucket_N_golfer_id` shape doesn't exist, so the tweak logic is adapted to the actual row-per-bucket model while preserving the requested semantics (any bucket differs → increment by 1, once per save).

## 1. Header (TournamentHub)

- Keep current layout: logo `<img src={t.logo_url}>` with placeholder fallback, `font-display` title, `MapPin` + `t.location`, `Calendar` + `tournamentDateRange(start,end)`, status badge on the right using `STATUS_META`.
- No structural change needed beyond confirming alignment; minor: make status badge accent map already covers `upcoming / open_for_picks / picks_closed / live / completed`.

## 2. Picks Card Refactor

- **Remove** the tournament status `Badge` next to "Picks" title. Keep only ONE submission-state badge:
  - `hasPicks` → green "Picks Submitted"
  - else → red `destructive` "Not Entered"
- **Top-right timestamp**: when `hasPicks`, show `Submitted: {new Date(lastEdited).toLocaleString()}` as subtle muted xs text.
- **Team handle line**: `{teamHandle}` (from `profile.team_nickname` → `activeTeam.nickname` → `profile.nickname`) followed by green `CheckCircle2`. Remove the "Your Team ·" prefix; team name is the primary label.
- **Tweaks line** (NEW): directly under team handle, render `text-xs text-muted-foreground` line: `Tweaks Made: {maxTweaks}` where `maxTweaks = Math.max(0, ...picks.map(p => p.tweak_count ?? 0))`.
- **Roster grid**: keep the existing 7-row B1–B7 list when `hasPicks`.
- **Empty state**: full-width "Submit Team Lineup →" button → `/tournament/$id/lineup` (disabled styling if `!canSubmit`).
- **Edit Picks button** (NEW): when `hasPicks && canSubmit`, render below the roster a secondary "Edit Picks" `Link` button to `/tournament/$id/lineup`. Hidden when status ∈ {`picks_closed`, `live`, `completed`} or deadline passed.

## 3. Vertical Nav Rows

Change grid from `grid-cols-1 md:grid-cols-3` to a vertical stack: `flex flex-col gap-3`. Each row is full-width, white/`bg-card` background, slate border (`border-border`), uniform padding (`p-4`), left-aligned icon, label + optional subtext, right-aligned `ChevronRight`.

- Row 1: `Trophy` "Leaderboard" → `/tournament/$id` (live standings).
- Row 2: `BarChart3` "Statistics" — subtext "Pick stats & fun facts — Tap to view" → `/stats`.
- Row 3: `FileText` "Blog" — `Collapsible` toggling `t.recap_blog` content.

## 4. Tweak Calculation Fix (lineup.tsx)

The current save loop increments `tweak_count` per-bucket-changed (one per row touched). The user wants exactly **+1 per save** if any of the 7 buckets differs from DB. Adapted to the row-per-bucket schema:

```ts
const buckets = [1,2,3,4,5,6,7];
const existingByBucket = new Map(existingPicks.map(p => [p.bucket, p]));

const hasChanges =
  existingByBucket.get(1)?.golfer_id !== selections[1] ||
  existingByBucket.get(2)?.golfer_id !== selections[2] ||
  existingByBucket.get(3)?.golfer_id !== selections[3] ||
  existingByBucket.get(4)?.golfer_id !== selections[4] ||
  existingByBucket.get(5)?.golfer_id !== selections[5] ||
  existingByBucket.get(6)?.golfer_id !== selections[6] ||
  existingByBucket.get(7)?.golfer_id !== selections[7];

const hadExisting = existingPicks.length > 0;
const tweakIncrement = hadExisting && hasChanges ? 1 : 0;
const currentTweaks = Math.max(0, ...existingPicks.map(p => p.tweak_count ?? 0));
const newTweaks = currentTweaks + tweakIncrement;
```

Then in the upsert loop: for any inserted/updated row, write `tweak_count: newTweaks` and `last_edited_at: now()`. This ensures all 7 rows stay in lockstep and the counter increments exactly once per save when something actually changed.

## Out of scope

- No schema change (the user's `bucket_N_golfer_id` columns and `team_picks.tweaks_count` don't exist; mapping to actual `picks` rows preserves intent).
- No new route; "Edit Picks" reuses `/tournament/$id/lineup`.
- No changes to home feed, admin, or other routes.