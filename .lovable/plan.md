## Scope
One file: `src/routes/_authenticated/admin.index.tsx`, `SubmissionsTab`. Two surgical edits — header label + cell source for the team column in both the grid and the CSV.

## 1. Grid table header + cell (lines ~728–751)

Replace the header label:
```tsx
<TableHead>profile.team_nickname</TableHead>
```

Replace the body cell so it reads from the resolved profile rather than the joined `teams.nickname`:
```tsx
<TableCell className="text-sm">{profileById.get(r.ownerUserId)?.team_nickname ?? "—"}</TableCell>
```

Bucket 1–7 cells and the Tweaks cell stay unchanged. `colSpan={9}` on the empty state stays correct.

## 2. `exportCsv()` (lines ~645–668)

- New header line (unquoted, exactly as specified):
  ```
  UUID,Full Name,Email,profile.team_nickname,Bucket 1,Bucket 2,Bucket 3,Bucket 4,Bucket 5,Bucket 6,Bucket 7
  ```
- Column 4 now pulls `p?.team_nickname ?? ""` instead of `r.teamName`.
- Column ordering preserved: UUID · `"Full Name"` · Email · profile.team_nickname · `"Bucket 1"` … `"Bucket 7"`.
- Bucket cells remain explicitly wrapped in double quotes with `—` fallback.
- Phone and tweaks remain excluded.

## Out of scope
- Other tabs, queries, RLS, schema.
- Pivot logic, KPIs, missing-users panel, copy-emails button.
