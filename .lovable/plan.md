## Scope
One file: `src/routes/_authenticated/admin.index.tsx`, inside `SubmissionsTab`. Two surgical edits.

## 1. Grid table (lines ~695–733)

**Header row** — replace the existing `<TableHead>User</TableHead>` (followed by `Team`) with a single:
```tsx
<TableHead>Team Name (Leaderboard Display)</TableHead>
```
Keep Bucket 1–7 and Tweaks headers as-is.

**Body row** — remove the entire user details `<TableCell>` (full name / email / phone block at lines 718–722) and remove the separate `Team` cell. Replace with one cell rendering the team name:
```tsx
<TableCell className="text-sm">{r.teamName}</TableCell>
```
Bucket cells (1–7) and Tweaks cell remain unchanged.

Update the empty-state `colSpan` from `10` to `9` (1 team + 7 buckets + 1 tweaks).

The `nameFor()` helper becomes unused on the grid — leave it (still useful for safety) or remove if cleanup desired.

## 2. `exportCsv()` (lines 604–627)

Replace header and cell mapping:

```ts
const headers = ["UUID","First Name","Last Name","Email","Team Name (Leaderboard Display)","Bucket 1","Bucket 2","Bucket 3","Bucket 4","Bucket 5","Bucket 6","Bucket 7"];
const lines = [headers.join(",")];
for (const r of pivotedRows) {
  const p = profileById.get(r.ownerUserId);
  const cells = [
    r.ownerUserId,
    p?.first_name ?? "",
    p?.last_name ?? "",
    p?.email ?? "",
    r.teamName,
    ...[1,2,3,4,5,6,7].map((b) => r.buckets[b] ?? ""),
  ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
  lines.push(cells.join(","));
}
```

Phone and tweaks are excluded; no trailing UUID column. Blob/download logic unchanged.

## Out of scope
KPIs, missing-users panel, copy-emails, queries, RLS, schema.
