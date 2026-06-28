## Goal
Switch the Advanced Field Portal bulk roster paste from comma-separated to pipe-separated (`|`) so golfer names with commas (e.g. "Rich Berberian, Jr.") parse correctly.

## File
`src/components/admin/advanced-field-portal.tsx` — only file touched (parser + UI both live here).

## Changes

### 1. Parser (`parseFieldCsv`, lines 38–115)
- Split each line on `|` instead of `,`, still trimming each part.
- Update structural error message to: `Expected 2 pipe-separated fields (Name | OWGR Ranking), got N`.
- If a line contains no `|` at all, surface a clearer reason: `Missing "|" delimiter — use: Name | OWGR Ranking`.
- Keep the existing blank-name, OWGR integer, and duplicate-name checks unchanged.
- Function name stays `parseFieldCsv` (no external callers besides this file) to minimise churn.

### 2. Help panel (lines 276–306)
- Title stays `CSV format` → change to `Roster format`.
- Instruction line → `One golfer per line. Two pipe-separated fields, in this exact order: Name | OWGR Ranking`.
- Format pre-block → `Name | OWGR Ranking`.
- Valid sample pre-block →
  ```
  Scottie Scheffler | 1
  Rich Berberian, Jr. | 2057
  ```
- Bullet "Exactly 2 fields per row — extra commas in the name will break the row." → `Exactly 2 fields per row, separated by "|". Commas in names are allowed.`

### 3. Textarea placeholder (line 326)
- `"Scottie Scheffler | 1\nRich Berberian, Jr. | 2057\nRory McIlroy | 2"`

## Out of scope
No DB / server / schema changes; no other components import the parser; bucket assignment, upload, purge, and metrics logic untouched.
