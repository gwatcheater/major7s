
## Goal

Debug why the custom recovery email template isn't visibly applied even though the PATCH returns success.

## Findings from exploration

- **Trigger is correct.** The mail icon in `users-directory-tab.tsx` calls `sendWelcomeEmails` (`src/lib/admin-users.functions.ts:302`), which uses `supabaseAdmin.auth.resetPasswordForEmail(...)`. That maps to the **recovery** template slot — same one being patched. So template/method match is not the bug. This will be confirmed via the new Verify button in step 4, and the answer will be surfaced in the UI.
- The current PATCH in `src/lib/auth-config-migration.functions.ts` already sends `mailer_subjects_recovery` and `mailer_templates_recovery_content`, but nothing is logged, so we can't see what GoTrue actually accepted/stored.

## Changes

### 1. `src/lib/auth-config-migration.functions.ts` — add request/response logging + return diagnostics

In `runAuthConfigMigration`:
- Before the PATCH: `console.log("[auth-migration] PATCH body:", JSON.stringify(patchBody))` and log key sizes (`recovery_html_length`, `recovery_subject`, `uri_allow_list`).
- After PATCH: read response with `patchRes.text()` (so we can log even on 2xx), log `status`, `headers` (content-type), and full body text.
- Parse body back to JSON if possible and extract the post-patch `mailer_subjects_recovery` + first 100 chars of `mailer_templates_recovery_content`.
- Return those echoed values in the function result so the admin UI can show them after running migration:
  ```
  { ok, allowListAdded, allowListAfter, templateUpdated,
    patchStatus, echoedSubject, echoedTemplatePreview, echoedTemplateLength }
  ```

### 2. New server function `verifyAuthConfig` (same file)

`createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(...)`:
- Same admin-role gate.
- `GET ${SUPABASE_URL}/auth/v1/admin/config` with service-role headers.
- Log full response status + body.
- Return:
  ```
  {
    status,
    recoverySubject: cfg.mailer_subjects_recovery ?? null,
    recoveryTemplatePreview: (cfg.mailer_templates_recovery_content ?? "").slice(0, 100),
    recoveryTemplateLength: (cfg.mailer_templates_recovery_content ?? "").length,
    uriAllowList: cfg.uri_allow_list ?? "",
    welcomeUrlPresent: (cfg.uri_allow_list ?? "").split(",").map(s=>s.trim()).includes("https://major7s.com/welcome"),
    sendMethod: "resetPasswordForEmail → recovery template (confirmed in code)",
  }
  ```

### 3. `src/routes/_authenticated/admin.index.tsx` — UI updates to `MigrationSetupCard`

- After "Run migration setup" succeeds, show the echoed subject + template preview + length under the button (small muted block).
- Add a second button **"Verify config"** next to it that calls `verifyAuthConfig` via `useServerFn`, stores result in local state, and renders:
  - `Subject:` value
  - `Template length:` chars
  - `Template preview:` first 100 chars in `<code>` block
  - `Welcome URL in allowlist:` ✓/✗
  - `Send method:` string (so user can confirm trigger uses recovery slot)
- Both buttons share an `isRunning` lock; toasts on success/failure unchanged.

## What we'll learn

- Console logs show exactly what was sent and what GoTrue echoed back.
- Verify button confirms whether the template actually persisted (the most likely cause: GoTrue silently ignoring `mailer_templates_recovery_content` if `mailer_autoconfirm` / template-related flags aren't set, or storing a different field name on this GoTrue version).
- If `echoedTemplatePreview` after PATCH ≠ what we sent, we know GoTrue rejected/ignored the field and we can switch field name (some versions use `mailer_templates.recovery.content` nested) on a follow-up.

No DB migration, no schema changes, no new secrets.
