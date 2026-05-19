## Goal

Replace the bulk-upload + field-list + (new) purge sections inside `src/routes/_authenticated/admin/tournament/$id/field` with a single, robust, typed `AdvancedFieldPortal` component. The existing Tournament Details, Submitted Picks, Bucket Sizes, and Add Golfer panels stay as-is — this work focuses on the four sub-systems the user spec'd.

## Where it lives

- New component: `src/components/admin/advanced-field-portal.tsx`
- Mounted inside `src/routes/_authenticated/admin.tournament.$id.field.tsx` (replaces the existing inline `bulkOpen` upload block and the bottom field list), wrapped by the existing `<AdminDesktopOnly>` gate.
- Props: `{ tournamentId: string; tournamentName: string; }`
- Uses existing shadcn components: `Button`, `Input`, `Textarea`, `Alert`, plus `sonner` `toast`. Lucide icons: `Upload`, `AlertTriangle`, `Trash2`, `Undo2`, `FileText`, `Users`, `CheckCircle2`, `XCircle`.

## 1. Bulk Upload Help Panel

A documentation `Alert` at the top of the portal:
- Header: "CSV Format" with `FileText` icon.
- A monospace `<pre>` block showing the schema: `Name, OWGR Ranking, Bucket Number (1-7)`.
- A second `<pre>` block showing a valid sample:
  ```
  Scottie Scheffler, 1, 1
  Rory McIlroy, 2, 1
  Ludvig Aberg, 5, 2
  ```
- Bullet rules (exactly 3 fields, name required, OWGR positive integer, bucket 1–7, no in-batch duplicates).

## 2. Parser + Per-Line Error Log

Pure function `parseFieldCsv(text: string): { rows: ParsedRow[]; errors: LineError[] }` with strict rules:

| Rule | Failure message |
| --- | --- |
| `split(",")` length ≠ 3 | "Expected 3 comma-separated fields, got N" |
| Trimmed name empty | "Name is required" |
| OWGR not `Number.isInteger` or `< 1` | "OWGR must be a positive integer" |
| Bucket not integer in 1..7 | "Bucket must be an integer from 1 to 7" |
| Name (case-insensitive) appears more than once in the same paste | "Duplicate name in batch" (flag every occurrence) |

UI:
- `Textarea` (min-height ~240px, monospace) bound to `bulkText`.
- Below it, a **Validation Log** panel:
  - If no input → muted "Paste rows to validate."
  - Render every line with its line number. Valid rows get a green left border + `CheckCircle2`. Invalid rows get a red left border + `XCircle` and the failure reason.
  - Summary row: "X valid · Y errors · Z total".
- **Upload button** disabled when any error exists or no valid rows. On click: single `supabase.from("golfers").insert(rows)` batch insert with `tournament_id` injected. On success: clear textarea, toast `${n} golfers added`, invalidate `["admin-field-golfers", tournamentId]`. On error: toast the Supabase message, keep textarea contents.

## 3. Field Metrics + Active Field List

Side panel (lg:grid-cols-3 layout — upload spans 2, metrics spans 1; stacks on mobile):
- **Total Registered** card: big number = `golfers.length`, `Users` icon.
- **Per-bucket chips**: 7 small badges B1–B7 with count, color-coded by bucket (use existing tokens: forest, gold, alert, etc. — defined as a `BUCKET_COLORS` map).
- **Scrollable list** (`max-h-[480px] overflow-y-auto`) of all golfers in the tournament:
  - Row: `[BX badge] Name … OWGR #N` with a small `Trash2` delete button.
  - Sorted by bucket then OWGR.

Reuses the existing `golfers` query (`["admin-field-golfers", id]`) — no new query needed; just lift it or pass via props.

## 4. Danger Zone — Atomic Purge with Undo

Distinct red-bordered container at the bottom (`border-destructive`, `AlertTriangle` icon, "Danger Zone" header).

State machine: `'idle' | 'arming' | 'counting' | 'purging'`.

Flow:
1. **idle**: Shows warning copy + a "Begin purge" button.
2. **arming**: Reveals a dynamically generated confirmation string `PURGE_${tournamentName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` shown in a `<code>` block, plus an `Input` the admin must type it into exactly. "Cancel" button reverts to idle. "Confirm" button enabled only when input matches verbatim.
3. **counting**: Replaces the panel with a prominent countdown box: "Purging in Ns…" with a big `Undo2` "STOP / UNDO" button. `useEffect` runs a 1s `setInterval` decrementing from 5; on 0 → transition to purging. Cleanup clears the interval if the user hits Undo (→ back to idle, `toast("Purge cancelled")`) or unmounts.
4. **purging**: Single `supabase.from("golfers").delete().eq("tournament_id", tournamentId)`. On success: toast "Field roster purged", invalidate queries, back to idle. On error: toast error, back to idle.

The countdown uses `useRef` for the interval handle so Undo immediately aborts before the DELETE fires — DELETE only executes inside the timer callback when the counter hits 0 and the state is still `counting`.

## Types

```ts
type ParsedRow = { line: number; name: string; owgr: number; bucket: number };
type LineError = { line: number; raw: string; reason: string };
```

## Integration steps

1. Create `src/components/admin/advanced-field-portal.tsx` with the parser, the three subsections (Help, Upload+Log, Metrics+List), and the Danger Zone state machine.
2. In `admin.tournament.$id.field.tsx`: delete the inline `bulkOpen`/`bulkText`/`bulkLog`/`runBulkUpload` block and the existing bottom field list grid; mount `<AdvancedFieldPortal tournamentId={id} tournamentName={tournament?.name ?? ""} />` in their place. Keep Details, Picks, Bucket Sizes, Add Golfer panels untouched.
3. Verify build + visit `/admin/tournament/:id/field` in the preview.

## Notes / non-goals

- No schema changes; uses existing `golfers` table + RLS (admin write policy already in place).
- Parser is pure and unit-test-friendly (could add a vitest later — not in scope unless asked).
- Mobile: the whole admin page is already gated by `AdminDesktopOnly`, so we design desktop-first but keep the portal responsive (`grid-cols-1 lg:grid-cols-3`) for the desktop-tablet landscape range.
