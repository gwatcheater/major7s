## Problem

The password reset email link drops users on `https://www.major7s.com/` instead of `/reset-password`.

The recovery email itself is fine — `confirmationUrl` is the Supabase `/auth/v1/verify?...&redirect_to=...` URL, and `login.tsx` correctly passes `redirectTo: ${origin}/reset-password` when calling `resetPasswordForEmail`.

The standard cause of this exact symptom is Supabase's **Redirect URL allowlist**. When the `redirect_to` value isn't on the allowlist, Supabase silently falls back to the project's **Site URL** (the index) after verifying the token. Since the custom domain `https://www.major7s.com` was added later, its `/reset-password` URL likely isn't allowed.

## Fix

Add the missing redirect URLs to the backend auth config so Supabase honors the `redirect_to` from the email:

- `https://www.major7s.com/reset-password`
- `https://www.major7s.com/**` (covers welcome resend, future auth flows)
- `https://major7s.lovable.app/reset-password`
- `https://major7s.lovable.app/**`

Also verify the **Site URL** is set to `https://www.major7s.com` so any future allowlist miss at least lands on the canonical domain.

These settings live in Lovable Cloud's auth settings (Cloud → Users → Auth Settings → URL Configuration). I'll guide you to the exact toggle — the redirect allowlist isn't editable from code on Lovable Cloud.

## Verification

After updating the allowlist:
1. Request a password reset from the login page on `www.major7s.com`.
2. Click the email link — should land on `/reset-password` with the recovery token in the URL hash, showing the "Set new password" form.

## Out of scope

No code changes are needed; the email template and client code already pass the correct `redirectTo`. If after updating the allowlist the link still lands on `/`, I'll then inspect the auth webhook payload to confirm the `redirect_to` Supabase is actually receiving.