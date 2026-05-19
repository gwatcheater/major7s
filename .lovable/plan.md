## Scope
`src/routes/_authenticated/admin.index.tsx`, `SubmissionsTab` only. Two small edits — rename one grid header, and tighten CSV cell quoting.

## 1. Grid table — rename the header

Single line change (~L739):
```tsx
<TableHead>Name</TableHead>
```

Body cell stays as-is — already renders `{profileById.get(r.ownerUserId)?.team_nickname ?? "—"}` directly. Bucket 1–7 cells and Tweaks cell untouched.

## 2. `exportCsv()` — enforce explicit `"…"` quoting on user inputs

Header line already matches the spec, no change needed:
```
UUID,Full Name,Email,profile.team_nickname,Bucket 1,Bucket 2,Bucket 3,Bucket 4,Bucket 5,Bucket 6,Bucket 7
```

Replace the row body so each cell is explicitly quoted per the spec (UUID and Email stay unquoted to preserve current shape and the user's "Column 0 = UUID / Column 2 = Email" ordering):

```ts
const row = [
  r.ownerUserId,                                                         // 0 UUID
  `"${p?.first_name ?? ""} ${p?.last_name ?? ""}"`,                      // 1 Full Name (quoted)
  p?.email ?? "",                                                         // 2 Email
  `"${p?.team_nickname ?? "—"}"`,                                        // 3 profile.team_nickname (quoted)
  ...[1, 2, 3, 4, 5, 6, 7].map((b) => `"${r.buckets[b] ?? "—"}"`),       // 4–10 buckets (quoted)
];
lines.push(row.join(","));
```

Exactly 11 columns. Phone and tweak_count stay excluded. Download/blob plumbing unchanged.

## Out of scope
Other tabs, KPIs, missing-users panel, queries, schema, RLS.
