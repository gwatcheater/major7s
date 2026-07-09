# Bulk Recovery Link — Approved Plan

Answers locked in:
1. Bump `auth.otp_expiry` to **259200 s (72 h)** via `supabase--configure_auth`. **Revert to Supabase default 3600 s (1 h) once the migration blast is complete** — I'll flag this in chat after the send.
2. Recovery link redirects to `/reset-password`; that page redirects to `/home` on success (unchanged).
3. New template `recovery-link.tsx`, password-set subject line (no welcome copy).

## Files

- MODIFY `src/lib/admin-users.functions.ts` — add `sendRecoveryLinks` server fn (mirrors `sendWelcomeEmails`: admin gate, suppression check, `generateLink(type:'recovery', redirectTo:/reset-password)`, render template, ensure unsubscribe token, insert `email_send_log` pending row, `enqueue_email` to `transactional_emails`, 150 ms throttle, `admin_audit` action `user.recovery_link_sent`). Returns `{ sent, failed, results:[{id,email,ok,error?}] }`.
- CREATE `src/lib/email-templates/recovery-link.tsx` — React Email template. Subject: **"Set your Major7s password"**. Body: brief note that an admin issued a password-set link, CTA button to `setPasswordUrl`, fallback text link, 72 h expiry notice. `#ffffff` body background, brand tokens from existing templates.
- MODIFY `src/lib/email-templates/registry.ts` — register `recovery-link`.
- MODIFY `src/components/admin/users-directory-tab.tsx` — add row checkboxes + header select-all-filtered, sticky bulk-action bar with "Send recovery link (N)", `useServerFn(sendRecoveryLinks)` call, success/failure toast, "Retry failed" affordance. Existing single-row detail flow untouched.
- CONFIG `supabase--configure_auth` — set OTP expiry to 259200 s.

No schema changes, no `_authenticated.tsx` changes, no new routes.
