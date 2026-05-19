
## Scope
File: `src/routes/_authenticated/admin.index.tsx` — only the `SubmissionsTab` (lines ~489–726). No schema or other-tab changes.

## Two caveats up front
1. The exact PostgREST embed in your message — `teams!inner( … profiles:profiles!owner_user_id (…) )` — will fail. There is **no FK from `teams.owner_user_id` to `public.profiles.id`** in this DB (the FK on auth users lives in `auth`). PostgREST needs a declared relationship to embed. I will instead embed `teams!inner(id, nickname, owner_user_id)` on `picks` (that FK does exist) and join to `profiles` in JS via a Map.
2. `tweak_count` is per-row-per-bucket in this schema, so the per-team aggregate is `Math.max(...rows.map(r => r.tweak_count))`, as requested.

## Changes inside `SubmissionsTab`

### A. Replace the picks query with an embedded join
Swap the current `picks` query for:
```ts
.from("picks")
.select(`
  id,
  bucket,
  tweak_count,
  tournament_id,
  golfers ( golfer_name ),
  teams!inner ( id, nickname, owner_user_id )
`)
.eq("tournament_id", activeId!)
```
This removes the need for the separate `teams` query and the `golferById` lookup map (golfer name comes back inline). The standalone `teams` and `golfers` queries on this tab get deleted.

### B. JavaScript pivot (one row per team)
Group fetched rows by `teams.id`:
```ts
type Pivoted = {
  teamId: string;
  teamName: string;
  ownerUserId: string;
  buckets: Record<1|2|3|4|5|6|7, string | undefined>; // golfer_name
  tweaks: number;
};
```
- `buckets[row.bucket] = row.golfers?.golfer_name`
- `tweaks = Math.max(tweaks, row.tweak_count)`

### C. Tournament-scoped intersection (the real bug fix)
```ts
const activeApprovedUsers = approved; // already filtered status="approved" by the query
const usersWithPicksForThisTournament = new Set(
  pivotedRows.map(r => r.ownerUserId).filter(Boolean)
);
const usersWhoHaveNotEnteredYet = activeApprovedUsers.filter(
  u => !usersWithPicksForThisTournament.has(u.id)
);
```

Why this fixes the reported bugs:
- Today the "missing" list is derived from approved users joined to their **primary team only**. A user who submitted under a non-primary team is wrongly marked missing.
- "Total Submissions Made" today = `rows.filter(hasSubmission).length`, which is also constrained to primary-team matches. After the fix it's strictly `usersWithPicksForThisTournament.size`, which counts every distinct owner who has saved picks for this tournament.

### D. KPI wiring
- `Total Active Approved Users` → `activeApprovedUsers.length`
- `Total Submissions Made` → `usersWithPicksForThisTournament.size`
- `Missing Entries` → `usersWhoHaveNotEnteredYet.length`

### E. Warning panel + Copy emails
The "X approved users have not submitted" alert and the `copyEmails()` handler both read from `usersWhoHaveNotEnteredYet` instead of the old `missing` array. Entries disappear the moment a user's picks save and the query invalidates.

### F. Spreadsheet grid + CSV
Render one row per **submitted team** (from the pivoted array), columns:
- User: `profile.first_name profile.last_name`, email, phone (lookup approved profile by `ownerUserId`; fall back to team nickname if no matching profile)
- Team: `teamName`
- B1–B7: `buckets[b] ?? "—"` (already the resolved `golfer_name`)
- Tweaks: `tweaks`

`exportCsv()` uses the same pivoted rows + the same name resolution so CSV cells are populated golfer names, not blanks.

### G. Query invalidation
Add the new query key `["admin-picks-for-tournament", activeId]` to the invalidation list inside `ApprovalsTab.setStatus` is **not** needed (status changes don't affect picks), but the pick-save flow already invalidates picks queries elsewhere — no change required here.

## Out of scope
- Tabs 1–3 (Approvals, Bulk Import, Tournament) are untouched.
- No DB migration, no FK additions, no RLS changes.

## Risk
Low. All changes are local to one component; queries already run under admin RLS (admin reads all profiles/teams/picks). The embedded select uses an existing FK (`picks.team_id → teams.id`).
