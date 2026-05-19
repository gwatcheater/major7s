## Scope

Two files were inspected:
- `src/components/admin/users-directory-tab.tsx` (Account Configuration Panel)
- `src/routes/_authenticated/admin.index.tsx` (Submissions tab + `exportCsv`)

The Account Configuration Panel already matches spec #1 end-to-end. Only the Submissions tab and CSV exporter need fixes.

## 1. Account Configuration Panel — verify, no edits

Current behavior already satisfies the request:
- Teams query orders `is_primary DESC, created_at ASC`, so the primary row renders at the top.
- Each row keys on `team.id`, binds `value={edits[team.id] ?? team.nickname}` and dispatches updates/deletes against `team.id`.
- Primary row shows an emerald `Primary` badge; non-primary shows a slate `Additional` badge.
- Delete button is `disabled={team.is_primary || busy}` and `handleDelete` short-circuits when `team.is_primary` is true.

No code change here. (Confirm during implementation that nothing has drifted.)

## 2. Submissions Spreadsheet — show the team identity, not the owner's profile

File: `src/routes/_authenticated/admin.index.tsx`, `SubmissionsTab` (~lines 554–804).

The pivot already groups by `teams.id` (good). The bug is only in the row renderer at ~line 779–795:

- "Name" column currently renders `p?.team_nickname` (the owner's primary `profiles.team_nickname`). Change it to render `r.teamName` (the joined `teams.nickname` for that specific team row).
- Add a small `UUID` column (or repurpose) so each row's `r.teamId` is visible, matching the requested "specific team's own unique ID database token" mapping. Concretely, prepend a `<TableHead>UUID</TableHead>` and a `<TableCell className="font-mono text-[10px]">{r.teamId}</TableCell>`, and update the empty-state `colSpan` from 10 → 11.
- Leave the `SimulateButton` wiring on `r.ownerUserId` (impersonation still targets the owning user account).

No changes to the pivot, query, or `profileById` lookup are required.

## 3. `exportCsv()` — align CSV with the on-screen grid

Same file, `exportCsv` (~lines 669–692). Replace the header string and per-row mapping so:

- Header line becomes:
  `UUID,Full Name,Email,Phone,Team Name (Leaderboard Display),Bucket 1,...,Bucket 7`
- Column 1 (`UUID`) → `r.teamId` (not `r.ownerUserId`).
- Column 2 (`Full Name`) → owner's full name resolved via `profileById.get(r.ownerUserId)` (unchanged logic).
- Column 3 (`Email`) → owner email (unchanged).
- Column 4 (`Phone`) → owner phone (newly surfaced; the lookup already returns it via `nameFor`).
- Column 5 (`Team Name (Leaderboard Display)`) → `r.teamName` (the specific team's nickname), not `p?.team_nickname`.
- Bucket columns unchanged.

CSV values keep their existing quoting; only the source fields swap.

## Out of scope

- No schema changes; no RLS changes; no new queries.
- No edits to impersonation, lineup, or tournament header code (already adjusted in prior turns).
- No edits to `users-directory-tab.tsx`.

## Verification after build

1. Open Admin → Submissions; confirm a user who owns 2+ teams now appears as multiple rows, each showing its own team nickname and its own team UUID.
2. Export CSV; confirm Column 1 holds team UUIDs and Column 5 holds the per-team nickname.
3. Open Admin → User Management → ⚙️ Manage Account on a multi-team user; confirm Primary (emerald, delete disabled) sits above Additional (slate, delete enabled) and each input edits its own row.
