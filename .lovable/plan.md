## Goal

Let admins change a user's email from the User Drawer in the Admin Users Directory. The change must update **auth** (the source of truth) and the **profiles** mirror in one atomic server-side action, with audit logging.

## What changes

### 1. New server function: `updateUserEmail` (`src/lib/admin-users.functions.ts`)

- `POST`, protected with `requireSupabaseAuth`.
- Input (Zod): `{ userId: string (uuid), newEmail: string (email, max 255) }`.
- Verifies the caller has the `admin` role via `user_roles` (same check `bulkCreateApprovedUsers` already uses).
- Loads the current email from `auth.users` (via `supabaseAdmin.auth.admin.getUserById`) for the audit detail and to no-op if unchanged.
- Calls `supabaseAdmin.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true })`.
  - `email_confirm: true` skips the confirmation round-trip so the change is immediate.
  - Maps "already registered / duplicate" errors to a friendly message ("That email is already in use").
- Updates `public.profiles.email` for that user so the mirror stays in sync. If this fails, returns a partial-success result so the UI can surface it (auth was changed; mirror needs retry).
- Writes an audit row by inserting directly into `public.admin_audit` with `supabaseAdmin` (bypasses RLS, same pattern as `audit_*` triggers):
  - `action = 'profile.email_change'`
  - `actor_id = context.userId`
  - `target_user = userId`
  - `detail = { from, to }`
- Returns `{ ok: true, from, to }` on success.

### 2. UI: editable email field in the User Drawer (`src/components/admin/users-directory-tab.tsx`)

In the existing "User Details" edit mode (around lines 754–760), replace the disabled email input with:

- Editable `Input` bound to local state `emailDraft` (initialised from `user.email`).
- A small "Update Email" button next to it that:
  1. Trims + validates with the same regex/Zod the server uses.
  2. Confirms via `window.confirm("Change login email from X to Y? The user will use the new email to sign in.")`.
  3. Calls the new server function via `useServerFn(updateUserEmail)`.
  4. On success: toast, clear draft, `qc.invalidateQueries({ queryKey: ["admin-users-profiles"] })` + `["admin-user-activity", user.id]`.
  5. On error: toast the message.
- Helper text below the field: "Updates the user's login email and profile. The user keeps their current password."
- Disabled while `busy` or when the draft equals current email or is invalid.
- Shadow Mode / impersonation: keep disabled (consistent with other admin writes — `assertWritable()` pattern is on the profile route; here the existing drawer doesn't gate, so we follow current drawer conventions and just rely on admin-role check server-side).

### 3. Activity feed

The existing "Account Activity" section already reads `admin_audit` for `target_user`, so the new `profile.email_change` rows appear automatically with date. No change required.

## Out of scope

- No migration. `admin_audit` already exists and accepts free-form `action` strings; no schema change needed.
- No notification email to the user (can be added later if desired).
- No bulk email change.
- Password reset / re-verification flow — `email_confirm: true` keeps the account active with the new address.

## Technical notes

- `supabaseAdmin` is imported at the top of `admin-users.functions.ts` already, so no import-graph concerns.
- We do NOT touch `auth.users` directly via SQL — always via the Admin API.
- Audit insert uses `supabaseAdmin` so it works regardless of the RLS policy on `admin_audit` (mirroring how `log_impersonation` and the `audit_*` triggers operate as `SECURITY DEFINER`).