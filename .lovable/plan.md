
# Major7s — Audit & Gap Analysis

This is an audit only. No files will be modified.

## 1. Component & Function Location Audit

| Feature | File | Key symbols |
|---|---|---|
| Tournament Detail view (leaderboard, stats, blog/recap rows) | `src/routes/_authenticated/tournament.$id.tsx` | `Route`, `tournament` query, `picks` query, `picksByBucket`, `maxTweaks`, rendered roster grid block ~lines 195–230 |
| Picks card / roster grid | Same file: `tournament.$id.tsx` | `picksByBucket` map (line 110), grid renderer iterating `[1..7]` (~line 195) showing `Bucket {b}` label |
| Edit Picks form (bucket dropdowns) | `src/routes/_authenticated/tournament.$id.lineup.tsx` | `selections` state, `byBucket` map, `existingByBucketMap`, `save()` handler, JSX `buckets.map(...)` ~line 205 |
| Admin Tournament Field Manager (CSV bulk upload) | `src/routes/_authenticated/admin.tournament.$id.field.tsx` + `src/components/admin/advanced-field-portal.tsx` | `bulkText`, `uploading`, `parsed = parseFieldCsv(bulkText)`, `canUpload`, upload action button (~line 270) |
| Save Lineup / tweaks_count handler | `tournament.$id.lineup.tsx` → `save()` (lines 96–150) | `existingByBucket`, `hadExisting`, `tweakIncrement` (accumulator loop lines 105–114), `currentTweaks`, `newTweaks`, upsert loop lines 122–144 |
| Onboarding gate status filters | `src/routes/_authenticated/admin.users.tsx` | `Status` type (`"pending" \| "approved" \| "rejected"`), `STATUS_LABEL`, `statusFilter` state, `StatusPill`, edit modal `draft.status` |
| Profile / Account settings | `src/routes/_authenticated/profile.tsx` | profile form (`team_nickname`, `nickname`, `first_name`, `last_name`, `phone`, `referral_name`), update mutation |

## 2. Logic & Data Handling Breakdown

**`tweaks_count` save logic (current state):**
- Located in `tournament.$id.lineup.tsx`, function `save()`, lines 96–150.
- It is **accumulative** — not capped, not Bucket-1-only. Each of the 7 buckets is tested independently with `if (existingByBucket.get(N)?.golfer_id !== selections[N]) tweakIncrement++;`. So changing 3 buckets in one save adds +3.
- Baseline is `currentTweaks = max(existingPicks.tweak_count)`, then `newTweaks = currentTweaks + tweakIncrement` is written to every bucket row in the upsert loop.
- Live preview (`liveTweaks`, line 160) mirrors the same accumulator: `maxTweaks + (hasSubmission ? changedCount : 0)`.

**Bucket row labels (current state):**
- Both screens render the clean form **`Bucket {n}`** with no `B1` / `B1 Bucket 1` prefix.
  - Detail page: `tournament.$id.tsx` line 204 — `Bucket {b}`.
  - Edit page: `tournament.$id.lineup.tsx` line 215 — `Bucket {b}`. (A `BUCKET_LABELS` constant at lines 16–22 also exists as `"Bucket 1"…"Bucket 7"`, but the JSX uses the inline template literal.)

## 3. New Features & Rebuild Checklist

### A) Fully Existing — functional, no changes needed
- Tournament Detail view shell (leaderboard area, picks roster grid, recap blog link rendering).
- Picks card / roster grid component on the detail page.
- Edit Picks form with 7 bucket dropdowns, save button, lock/deadline guard.
- Admin Tournament Field Manager with CSV bulk upload (`advanced-field-portal.tsx`).
- `tweaks_count` save handler — already implements the **accumulative** per-bucket counter per the latest spec.
- Bucket labels — already standardized to `Bucket N` on both screens.
- Onboarding status filter (`pending` / `approved` / `rejected`) on the admin users screen, including `StatusPill` and per-user edit modal with approve/reject controls.
- Profile / Account settings form.
- Post-save redirect from Edit Picks → `TournamentDetailView` (`navigate({ to: "/tournament/$id", params: { id } })`, line 149).

### B) Requires Patch / Partial Rebuild
- **Rejected user UX**: today rejection is only a `StatusPill` + filter in the admin table; there is no enforcement on the signed-in user's side. A rejected user can still pass `_authenticated` and reach the app shell. Patch the `_authenticated.tsx` gate (or add a layout guard) to read `profiles.status` and render a block/redirect for `rejected`.
- **Pending user UX**: similar — the gate doesn't differentiate `pending` vs `approved`. If the blueprint requires a "waiting for approval" screen, the gate needs a branch for `pending`.
- **Single source of truth for bucket labels**: `BUCKET_LABELS` constant exists in `tournament.$id.lineup.tsx` but isn't used in the JSX (inline `Bucket {b}` is rendered). Minor cleanup, not a functional bug.
- **OWGR formatting in dropdown labels**: confirm both screens render `Golfer Name (OWGR #Rank)` consistently — needs a quick spot-check pass; trivially patchable in one place each.

### C) Completely Missing / Brand New
- **Admin Deletion Safeguard "Undo" timer** — no toast-with-undo / soft-delete buffer exists for any admin destructive action (users, tournaments, field rows). No code present.
- **Conflict Ingestion Selector toggle** (CSV upload merge vs. replace / conflict resolution UI) — `advanced-field-portal.tsx` only supports a straight upload of `bulkText`; there is no per-row conflict picker or mode toggle.
- **Roster Balance Diagnostics graph widget** — no chart/visualization component exists (no recharts/visx usage for roster distribution).
- **Rejected full-screen block page** — no dedicated route or guarded screen for `status = 'rejected'` users (see B). This is effectively new UI even though the status field exists.
- **Pending "awaiting approval" full-screen** — same situation, no dedicated screen.

### Summary table

| Item | Bucket |
|---|---|
| Tournament Detail view | A |
| Picks roster card | A |
| Edit Picks form | A |
| Admin Field Manager + CSV upload | A |
| `tweaks_count` accumulator | A |
| Bucket label cleanup (`Bucket N`) | A |
| Admin user status filter UI | A |
| Profile settings form | A |
| Post-save redirect to detail view | A |
| Rejected/Pending user gating (full-screen block) | C (gate code requires B-level patch in `_authenticated.tsx`) |
| Admin Undo timer for deletions | C |
| CSV Conflict Ingestion Selector | C |
| Roster Balance Diagnostics graph | C |

No code edits performed. Ready to scope any of the B/C items into an implementation plan on request.
