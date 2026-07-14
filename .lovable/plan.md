# Auth & Password Capabilities — Major7s (Lovable Cloud)

Deliverable: save the answers below to `docs/auth-capabilities.md`. No code changes.

---

## 1. Current dashboard config

- **`auth.otp_expiry`**: not exposed to me via tooling on Lovable Cloud. The last known value is whatever you set during the migration window (you asked for 259200 = 72h). I cannot read the live value programmatically — check Cloud → Users → Auth Settings (gear) → Email → "Email OTP expiration". Flag: if you bumped it to 72h for the migration, revert to 3600 (1h) once the migration blast is complete.
- **Site URL**: `https://www.major7s.com`
- **Redirect allow-list** (confirmed live):
  - `https://www.major7s.com/**`
  - `https://www.major7s.com/reset-password`
  - `https://www.major7s.co.uk`
  - `https://id-preview*--ddc5fca9-4f56-4e27-b687-3d128d3726dc.lovable.app/**`
  - `https://id-preview*--ddc5fca9-4f56-4e27-b687-3d128d3726dc.*.lovable.app/**`
  - `https://ddc5fca9-4f56-4e27-b687-3d128d3726dc.lovableproject.com/**`
  - `https://ddc5fca9-4f56-4e27-b687-3d128d3726dc-thr_*.lovableproject.com/**`
  - `https://preview--major7s.lovable.app/**`
  - `https://major7s.lovable.app/**`
- **SMTP / email provider**: Lovable Emails (managed), sending domain `notify.www.major7s.com` — verified, NS-delegated to `ns5/ns6.lovable.cloud`. Not Supabase default SMTP, not a third-party (Resend/SendGrid). Queue is healthy (748 sent / 7d, 31 dead-lettered — permanent failures, no auto-retry).
- **Auth email templates**: rendered in-app via React Email, not via Supabase's template editor. Recovery template = `src/lib/email-templates/recovery.tsx`. Subject `"Reset your password"` (from `EMAIL_SUBJECTS` in `src/routes/lovable/email/auth/webhook.ts`). No expiry language in the body. Link resolves via the auth webhook: it appends `token_hash` + `type=recovery` onto `redirect_to` (default `https://www.major7s.com/reset-password`).
- **Rate limits**: `rate_limit_email_sent` is not readable via my tools. Support-confirmed 200/hr is the value in effect unless you've changed it since. I can raise it (max 1000/hr) via `supabase--configure_auth` if needed. GoTrue also has non-configurable per-IP and per-email throttles (e.g. 60s between recovery requests for the same address); those aren't tunable.

## 2. What's accessible to us vs. Lovable-only

**Callable from our server code** via `supabaseAdmin` (service-role client in `src/integrations/supabase/client.server.ts`) — the full Supabase Auth Admin API. Confirmed usable on Lovable Cloud:
- `auth.admin.listUsers`, `getUserById`
- `auth.admin.createUser`, `updateUserById` (incl. `{ password }`, `{ email }`, `{ email_confirm: true }`, `{ user_metadata }`, `{ ban_duration }`)
- `auth.admin.deleteUser`
- `auth.admin.generateLink` (all types: `signup`, `magiclink`, `recovery`, `invite`, `email_change_current/new`) — you're already using `recovery`
- `auth.admin.inviteUserByEmail`
- `auth.admin.mfa.listFactors` / `deleteFactor`
- Session admin: `auth.admin.signOut`

No Lovable-specific blocklist on these — they hit GoTrue directly with the service-role JWT. The `auth` schema itself is read-only over PostgREST (you can `SELECT` via SQL but not `INSERT/UPDATE` tables directly) — the Admin API is the supported write path.

**Dashboard-only / not scriptable from our app code**:
- `otp_expiry`, `password_min_length`, `mailer_autoconfirm`, `disable_signup`, HIBP toggle, `rate_limit_email_sent`, `site_url`, `uri_allow_list`, SMTP provider config, email template bodies stored in GoTrue, provider (Google/Apple) client IDs & secrets, JWT expiry.
- I can change some of these for you via tools: `supabase--configure_auth` (auto-confirm, disable-signup, anon users, HIBP, email rate limit) and `supabase--configure_social_auth` / `supabase--configure_saml_sso`. **I cannot** set `otp_expiry`, `site_url`, or the redirect allow-list from tooling — those are Cloud → Users → Auth Settings (gear icon) in the Lovable UI. Same place for HIBP if you'd rather click than have me toggle it.

## 3. Setting a user's password directly

Yes. `supabaseAdmin.auth.admin.updateUserById(userId, { password: '...' })` works from any `createServerFn` handler that imports `supabaseAdmin` from `@/integrations/supabase/client.server`. Restrictions:
- Must run server-side only (service-role key must never reach the browser). Gate the server fn with `requireSupabaseAuth` + `has_role(auth.uid(), 'admin')`.
- Password must pass GoTrue's `password_min_length` (and HIBP if enabled) — else returns `weak_password` / `pwned_password`.
- No `password_hash` support — plaintext only; GoTrue rehashes with bcrypt. You cannot import pre-hashed passwords from another system through the Admin API.
- Rate-limited per project (generous, not the 200/hr email cap — that's email-only).
- Silent: does **not** email the user. If you want them notified, enqueue a transactional email yourself.

**Lovable-native alternative**: none. `updateUserById` is the recommended path.

## 4. Constraints / gotchas specific to this project

- **Sending domain is NS-delegated** to Lovable (`notify.www.major7s.com`). You cannot layer Resend/SendGrid on the same subdomain while delegation is active. A different subdomain (`mail.` etc.) would be fine.
- **Recovery link flow is custom**: the auth webhook (`src/routes/lovable/email/auth/webhook.ts`) rewrites recovery links to point at `/reset-password` with `token_hash` + `type=recovery`. `src/routes/__root.tsx` + `src/routes/index.tsx` intercept recovery events for logged-in users and force-redirect. If someone edits the webhook or those routes, recovery breaks silently — this is your historical flake source, not GoTrue itself.
- **`/reset-password` must stay in the redirect allow-list** (it is) — the explicit entry is what makes the webhook-built URL valid.
- **31 dead-lettered emails in the last 7d** — no auto-retry. Not a limit; likely bad addresses from the migration cohort. Worth spot-checking `email_send_log` where `status='dlq'` before another blast.
- **OTP expiry ≠ password reset link expiry in the UI wording** — the same setting governs both. If you leave it at 72h post-migration, day-to-day password resets also stay valid for 72h (weaker security posture). Revert after the migration cutover.
- **Auto-confirm**: currently off (users go through your `pending → approved` admin flow). Don't enable it — it would break the approval gate.
- **No Supabase dashboard access** on Lovable Cloud — all "go to Supabase" advice from generic docs doesn't apply. Everything is either in Cloud → Users / Emails, or scriptable via `supabaseAdmin` in a server fn.

---

Approve to save this to `docs/auth-capabilities.md`. Reject if you'd rather keep it in chat only.
