## Why

`/auth/v1/admin/config` is not exposed on Lovable Cloud (404), so the "Run migration setup" button never patched the recovery template. The right way to customize the password-reset email on this stack is the Lovable auth email template system, not the GoTrue admin API.

## Changes

### 1. Strip the dead migration code

- `src/routes/_authenticated/admin.index.tsx`
  - Remove the red `CARD DEBUG` div (line 101).
  - Remove the `MigrationSetupCard` component entirely and its render at line 100.
  - Remove the `runAuthConfigMigration` / `verifyAuthConfig` import (line 49).
- `src/lib/auth-config-migration.functions.ts` — delete the file.

(The redirect-allowlist concern is separate; if `https://major7s.com/welcome` still needs allowlisting, that's a Cloud → Auth settings task, not something we can do via Admin API on this stack. Out of scope for this plan unless you ask.)

### 2. Scaffold + customize the recovery email template

This stack doesn't yet have any auth email templates. Setup:

1. Run `email_domain--check_email_domain_status` to confirm an email domain exists (it should, since you've been sending recovery emails). If none is configured, surface the email-setup dialog first.
2. Run `email_domain--scaffold_auth_email_templates`. This creates the six auth templates (signup, magiclink, **recovery**, invite, email-change, reauthentication) and the auth webhook route that enqueues sends through Lovable Emails. On this TanStack stack the templates land under `src/lib/email-templates/` (React Email `.tsx`), not `supabase/functions/_shared/email-templates/` — the legacy Deno path doesn't apply here. The deliverable is the same: a recovery template you can fully brand.
3. Edit the **recovery** template:
   - Subject: `You're in — set up your Major7s account`
   - Outer `Body` background: `#ffffff` (required even for dark themes).
   - Header bar: forest green `#103D2E`, white text "Major7s.com Is Live. Tweaked, Upgraded."
   - Greeting: `Hi {firstName},` when `firstName` prop is present, else `Hi there,` (recovery template variables include `{{ .Data.first_name }}` from user metadata; passed into the React component as a prop by the webhook).
   - Body copy, in this order:
     - "Major7s has moved to a brand-new home."
     - "Your account is already set up. We've pre-loaded your details and your full picks history, so everything from previous years is waiting for you — nothing to re-enter."
     - "There's one thing left to do: set a password and you're ready to play."
   - CTA button: gold `#C9A227` background, dark (`#103D2E`) text, label **Set your password**, href = the existing recovery confirmation URL prop (the value the scaffold wires from `{{ .ConfirmationURL }}`).
   - Plain-text fallback line below the button showing the same URL.
   - Footer: "You're receiving this because you have previously played Major7s. If you weren't expecting it, you can safely ignore this email — no account changes will be made until you set a password."
   - Keep all auth variables (`ConfirmationURL`, token, etc.) intact — only restyle and rewrite copy.

### 3. Redeploy

Modern TanStack server routes deploy with the app on publish — there's no separate `deploy_edge_functions` step. After saving the template, the next build/publish ships it. I'll note this clearly so you know no manual deploy is required.

## Out of scope

- Re-adding `https://major7s.com/welcome` to the auth redirect allowlist (no public API for it on Lovable Cloud — needs Cloud UI or a separate request).
- Touching the other five auth templates (signup, magiclink, invite, email-change, reauthentication) — leaving them as the scaffolded defaults unless you want them branded too.
