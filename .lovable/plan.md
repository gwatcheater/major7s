
## Goal

Add a NEW app email "Migration welcome" for pre-provisioned users. Rewire the existing admin "Send welcome" action to mint a recovery link via `generateLink` and send the new app email (instead of calling `resetPasswordForEmail`, which sends a Supabase auth email). Revert the recovery auth email to default wording. Don't touch the `/welcome` page or any other auth template.

## Changes

### 1. Revert recovery auth email to default
- `src/lib/email-templates/recovery.tsx` — already uses default "Reset Your Password" wording. No body change needed; verify it stays default.
- `src/routes/lovable/email/auth/webhook.ts` — change `EMAIL_SUBJECTS.recovery` from `"You're in — set up your Major7s account"` back to default `"Reset your password"`. Default `redirect_to` for recovery stays `https://${ROOT_DOMAIN}/reset-password` (already correct).

### 2. New app email template
- Create `src/lib/email-templates/migration-welcome.tsx`:
  - Props: `firstName?: string`, `setPasswordUrl: string`.
  - Layout/styles match `welcome.tsx`/`recovery.tsx`: white outer body, forest `#103D2E` header bar, gold `#C9A227` button with `#103D2E` dark text.
  - Greeting `Hi {firstName},` else `Hi there,`.
  - Header heading: `Major7s.com Is Live. Tweaked, Upgraded.`
  - Three body paragraphs, button "Set your password" → `setPasswordUrl`, plain-text fallback link below button, footer copy — exactly as specified.
  - Export `template` satisfying `TemplateEntry` with `subject: "You're in — set up your Major7s account"`, `displayName: "Migration welcome"`, `previewData: { firstName: 'Rob', setPasswordUrl: 'https://www.major7s.com/welcome' }`.
- Register in `src/lib/email-templates/registry.ts` under key `"migration-welcome"`.

### 3. Rewire `sendWelcomeEmails` in `src/lib/admin-users.functions.ts`
- Keep signature `{ userIds, redirectTo }` so call sites in `users-directory-tab.tsx` (per-user mail icon + bulk button) work unchanged.
- For each user:
  1. Resolve `email` and `first_name` from `profiles`.
  2. `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })` to MINT the link without sending. Use `data.properties.action_link` as `setPasswordUrl`.
  3. Render `migration-welcome` template via React Email → html + plaintext.
  4. Enqueue into pgmq queue `transactional_emails` via `supabase.rpc('enqueue_email', …)` with the same payload shape used by `transactional/send.ts` (message_id, from, sender_domain, subject, html, text, purpose, label, idempotency_key=`migration-welcome:${userId}`, queued_at). Insert pending row into `email_send_log` before enqueue, failed row on enqueue error (matches existing pattern).
  5. Check `suppressed_emails` first; skip + log `suppressed` if hit.
- Keep the 150ms throttle and the `admin_audit` insert with `action: "user.welcome_sent"`.
- Return the same `{ sent, failed, results }` shape.

### 4. Redirect URL
- `/welcome` is the redirect target passed in by the admin UI (already wired). Surface a one-line note that `https://www.major7s.com/welcome` (and `https://major7s.lovable.app/welcome`) must be in the Supabase Auth → URL Configuration → Redirect URLs list — required for `generateLink` to honour the redirectTo. No code change for this; the comment block already mentions it.

### 5. Verification
- Build passes (typecheck via Vite plugin).
- Recovery template/subject restored to default.
- `migration-welcome` shows up in registry.
- `sendWelcomeEmails` uses `generateLink` + transactional enqueue, no `resetPasswordForEmail` call remaining.
- Call sites in `users-directory-tab.tsx` unchanged.

No DB migrations. No changes to `/welcome` page or other auth templates.
