## Goal

Add a one-time "Run migration setup" button in the admin panel that:
1. Appends `https://major7s.com/welcome` to Supabase Auth's redirect URL allowlist (preserving existing entries).
2. Sets the password recovery email template (subject + branded Major7s HTML body).

Both changes use `PATCH /auth/v1/admin/config` with the service role key.

## Files

**New: `src/lib/auth-config-migration.functions.ts`**
- `runAuthConfigMigration` server function (`createServerFn`, POST, `requireSupabaseAuth` middleware).
- Asserts caller has `admin` role (same pattern as `admin-users.functions.ts`).
- Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env` inside the handler.
- `GET {SUPABASE_URL}/auth/v1/admin/config` to read current `uri_allow_list` (comma-separated string per GoTrue).
- Merges in `https://major7s.com/welcome` if missing; leaves the rest untouched.
- `PATCH` the same endpoint with:
  - `uri_allow_list`: merged value
  - `mailer_subjects_recovery`: `You're in — set up your Major7s account`
  - `mailer_templates_recovery_content`: the exact HTML body from the request
- Headers: `apikey: <service_role>`, `Authorization: Bearer <service_role>`, `Content-Type: application/json`.
- Writes a row to `admin_audit` (`action: 'auth.config_migration'`, detail: which fields were updated, before/after allowlist).
- Returns `{ ok: true, allowListAdded: boolean, templateUpdated: true }` or throws on non-2xx (including provider message).

**Edit: `src/routes/_authenticated/admin.index.tsx`**
- Add a small "Migration setup" card (collapsible or plain Card) in the admin console with:
  - Title + one-line description ("One-time: configure welcome redirect + reset password email template").
  - Button labelled **Run migration setup**.
  - Uses `useServerFn(runAuthConfigMigration)` + local `isRunning` state.
  - On success: `toast.success("Migration setup complete")`.
  - On failure: `toast.error(error.message)`.
- Placement: top of the existing admin index (near other admin tools), gated by the existing `isAdmin` check that already wraps the page.

## Technical notes

- Endpoint shape (GoTrue admin config): fields used here are `uri_allow_list` (CSV string), `mailer_subjects_recovery` (string), `mailer_templates_recovery_content` (HTML string). Template variables `{{ .ConfirmationURL }}` and `{{ .Data.first_name }}` are passed through verbatim — GoTrue renders them.
- No DB migration required.
- No new secrets — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` already exist.
- Idempotent: re-running won't duplicate the welcome URL (set-merge) and will simply overwrite the template with the same content.

## Out of scope

- No UI for editing the template later.
- No automatic scheduling — manual button only, as requested.
