## Audit Result Summary

The four-tab admin shell, the deletion safeguard, and the diagnostics chart are all **already present** in the current codebase. The only genuinely missing item from your spec is the CSV **conflict-ingestion selector** in the Bulk Import tab.

---

## 1. Dropped Tab & Sub-Page Audit

| Feature | Status | Location |
|---|---|---|
| Tab A — User Approval Queue | **Intact** | `admin.index.tsx` → `ApprovalsTab()` lines ~106–203. Table at L151–194 with `setStatus(p.id, "approved" / "rejected")` action buttons (L177, L184). |
| Tab B — Bulk User Upload Ingestion | **Intact** | `admin.index.tsx` → `BulkImportTab()` lines ~205–315. Textarea L267, server fn `bulkCreateApprovedUsers` (L209) auto-sets `status="approved"` in `src/lib/admin-users.functions.ts`. |
| Tab C — Tournament Field Manager | **Intact** | `admin.index.tsx` → `TournamentTab()` lines ~317 onward. Form fields incl. `logo_url` (L410), `submission_deadline` (L413), 5-status toggle, plus **Roster Balance Diagnostics** chart at L456–483 (Recharts LineChart, ReferenceLine y=4 "Min 4" threshold, asymmetry alert L472–480). |
| Tab D — Submissions | **Intact** | `SubmissionsTab()` L489+ (just patched). |

All four tabs are wired in `<TabsList>` at L86–91 and rendered L93–96. **No tabs are dropped or unlinked.**

---

## 2. Overwritten Logic & Code Differences

| Utility | Status | Evidence |
|---|---|---|
| 5-second delayed admin deletion safeguard + `PURGE_*` phrase match | **Intact** | `src/components/admin/advanced-field-portal.tsx` — `PURGE_${slug}` token at L127, `undoCountdown()` at L458, confirmation copy L495 + L540, undo button L545. Lives on the per-tournament Field Manager route `admin.tournament.$id.field.tsx`, not on the main admin index. |
| CSV bulk conflict ingestion selector (Skip / Overwrite / Abort) | **Missing** | No matches for `Skip / Overwrite / Abort` anywhere. `BulkImportTab` (L205–315) has no radio group; behaviour today is fixed: duplicate emails simply fail per-row inside `bulkCreateApprovedUsers` and surface in `report.failed`. |
| "Copy All Email Addresses" clipboard extractor | **Intact** | `SubmissionsTab.copyEmails()` L589 + button L657–658, pulling from `usersWhoHaveNotEnteredYet`. |

---

## 3. Recovery Checklist & Next Steps

Only one item needs work.

### Conflict Ingestion Selector — **[Completely Deleted / Requires Fresh Injection]**

**Where to inject:**
- UI: `admin.index.tsx` inside `BulkImportTab`, between the format `<Alert>` (L258–265) and the `<Textarea>` (L267). Add a shadcn `RadioGroup` with three options: `skip` (default), `overwrite`, `abort`.
- State: add `const [conflictMode, setConflictMode] = useState<"skip" | "overwrite" | "abort">("skip");` near L206.
- Wire-through: pass `conflictMode` in the `bulk({ data: { rows, conflictMode } })` call at L239.
- Server: extend `bulkCreateApprovedUsers` in `src/lib/admin-users.functions.ts`:
  - Add `conflictMode` to the Zod input schema.
  - On `createUser` error matching "already registered" / duplicate email:
    - `skip` → mark row `{ ok: false, error: "skipped (exists)" }`, continue.
    - `overwrite` → look up existing user via `supabaseAdmin.auth.admin.listUsers`, update `profiles` metadata, force `status="approved"`, continue.
    - `abort` → throw, halting the loop; existing successes already persisted are returned.
  - Surface the mode in the final toast (e.g. `Imported X · Skipped Y · Overwritten Z`).

### Everything else — **[Partially Intact / No patch required]**

- Approvals tab, Bulk Import textarea, Tournament form + Diagnostics chart, Deletion safeguard, Copy-emails button — all verified present at the line numbers above.

## Out of scope
- No schema changes.
- No alterations to the Submissions tab (just patched).
- No new routes; safeguard stays under `admin.tournament.$id.field.tsx`.
