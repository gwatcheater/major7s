# Major7s — Email Handover Document

Read-only inventory of every email this app can send, traced to source. All file paths and quoted source were captured directly from the repo. No code was changed in producing this document.

## Environment

- **Active sending domain (verified):** `notify.www.major7s.com` (delegated to Lovable nameservers `ns5.lovable.cloud`, `ns6.lovable.cloud`). Source: `email_domain--check_email_domain_status`.
- **From header:** `major7s <noreply@www.major7s.com>` (constant `FROM_DOMAIN = "www.major7s.com"` in `src/routes/lovable/email/auth/webhook.ts`, `src/routes/lovable/email/transactional/send.ts`, `src/lib/admin-users.functions.ts`, and hardcoded in `src/routes/api/public/hooks/{new-user-signup,pick-reminder}.ts`).
- **Queue throughput (`email_send_state`):** `batch_size = 10`, `send_delay_ms = 200`, `auth_email_ttl_minutes = 15`, `transactional_email_ttl_minutes = 60`, `retry_after_until = null`. With a 10-message batch sent every 5s by cron and 200ms inter-send delay (~2s/batch), the practical ceiling is roughly **~120 emails/min** as documented in the email-infrastructure guide. Tunable via the `email_send_state` row; no redeploy needed.
- **Dispatcher:** `/lovable/email/queue/process` (`src/routes/lovable/email/queue/process.ts`). Auth gate: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Pulls `auth_emails` first, then `transactional_emails`. Honours 429 `Retry-After`, sends 403s straight to DLQ, retries on transient failure up to `MAX_RETRIES = 5` based on `email_send_log.status = 'failed'` rows, then DLQs.
- **Unsubscribe footer policy:** The transactional send route (`src/routes/lovable/email/transactional/send.ts`) issues/looks up a per-recipient token in `email_unsubscribe_tokens` and forwards it on the queue payload as `unsubscribe_token`. The upstream `sendLovableEmail` call in the dispatcher receives that token (`src/routes/lovable/email/queue/process.ts` line 236) and the Lovable email gateway injects the `List-Unsubscribe` header + footer. **Templates themselves do not render unsubscribe markup.**
  - App emails routed through `/lovable/email/transactional/send` → footer added.
  - App emails enqueued **directly via `enqueue_email` RPC without going through the send route** (`migration-welcome`, `admin-new-user`, `pick-reminder`) do **NOT** set `unsubscribe_token` on the payload, so the gateway has nothing to attach. See "Issues" below.
  - Auth emails (`auth_emails` queue) never carry `unsubscribe_token` and never get a footer — this matches Lovable defaults for transactional auth mail.

---

## Summary Table 1 — All emails

| Name | Type | Trigger | Live? | Template path |
|---|---|---|---|---|
| Confirm signup | Auth | Auto — Supabase `signup` auth hook | Live | `src/lib/email-templates/signup.tsx` |
| Password reset (recovery) | Auth | Auto — Supabase `recovery` auth hook | Live | `src/lib/email-templates/recovery.tsx` |
| Invite | Auth | Auto — Supabase `invite` auth hook | Scaffolded, no active caller (no invite flow in the app) | `src/lib/email-templates/invite.tsx` |
| Magic link | Auth | Auto — Supabase `magiclink` auth hook | Scaffolded, no active caller (login uses password) | `src/lib/email-templates/magic-link.tsx` |
| Email change | Auth | Auto — Supabase `email_change` auth hook (admin email edits use `admin.updateUserById` with `email_confirm: true`, which bypasses this) | Scaffolded; only fires if a self-service email change occurs (none in app) | `src/lib/email-templates/email-change.tsx` |
| Reauthentication | Auth | Auto — Supabase `reauthentication` auth hook | Scaffolded, no active caller | `src/lib/email-templates/reauthentication.tsx` |
| Admin: new user signup | App | Auto — client `fetch('/api/public/hooks/new-user-signup')` after `supabase.auth.signUp` succeeds | Live | `src/lib/email-templates/admin-new-user.tsx` |
| Migration welcome | App | Admin-triggered — "Send welcome" / bulk action in admin Users tab → `sendWelcomeEmails` | Live | `src/lib/email-templates/migration-welcome.tsx` |
| Pick deadline reminder | App | Cron — `pg_cron` POSTs `/api/public/hooks/pick-reminder` every 30 min | Live | `src/lib/email-templates/pick-reminder.tsx` |
| Picks confirmation | App | Auto — `sendPicksConfirmation` server fn called from lineup save in `src/routes/_authenticated/tournament.$id.lineup.tsx` | Live | `src/lib/email-templates/picks-confirmation.tsx` |
| Welcome (generic) | App | **None** — registered in `TEMPLATES` but no caller references `'welcome'` | **Unused / dead** | `src/lib/email-templates/welcome.tsx` |

## Summary Table 2 — Sender functions / routes

| Function / route | File | Emails it sends | Send mechanism |
|---|---|---|---|
| `POST /lovable/email/auth/webhook` | `src/routes/lovable/email/auth/webhook.ts` | signup, recovery, invite, magiclink, email_change, reauthentication | Receives signed payload from Supabase Auth Hook (verified via `verifyWebhookRequest` + `LOVABLE_API_KEY`). Renders React Email template, then `enqueue_email('auth_emails', …)` |
| `POST /lovable/email/transactional/send` | `src/routes/lovable/email/transactional/send.ts` | Any registered template (used in practice by `picks-confirmation`) | Bearer JWT auth via `supabase.auth.getUser`. Suppression check + unsubscribe token mint, render template, `enqueue_email('transactional_emails', …)` |
| `sendPicksConfirmation` (server fn) | `src/lib/email/picks-confirmation.functions.ts` | picks-confirmation | `requireSupabaseAuth` middleware; builds `templateData`, then internal `fetch` to `/lovable/email/transactional/send` forwarding caller's bearer token |
| `sendWelcomeEmails` (server fn) | `src/lib/admin-users.functions.ts` | migration-welcome | `requireSupabaseAuth` + admin check. For each user: `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', redirectTo })`, render `migrationWelcomeTemplate`, then `enqueue_email('transactional_emails', …)` directly via `supabaseAdmin`. **Bypasses `/lovable/email/transactional/send`.** No `unsubscribe_token`. |
| `previewWelcomeEmails` (server fn) | `src/lib/admin-users.functions.ts` | none (diagnostic — renders only, no enqueue) | Renders `migration-welcome` for given userIds and returns greeting + HTML snippet |
| `POST /api/public/hooks/new-user-signup` | `src/routes/api/public/hooks/new-user-signup.ts` | admin-new-user | Public route. Looks up profile by email, dedupes against `email_send_log` last 24 h, renders template, enqueues to `transactional_emails` directly via `supabaseAdmin`. **Bypasses `/lovable/email/transactional/send`.** No `unsubscribe_token`. No signature/secret on the public endpoint. |
| `POST /api/public/hooks/pick-reminder` | `src/routes/api/public/hooks/pick-reminder.ts` | pick-reminder | Public route gated by `apikey` header == `SUPABASE_PUBLISHABLE_KEY`. Loops tournaments in 2h45m–3h15m window, finds approved users without picks, renders template, enqueues to `transactional_emails` directly via `supabaseAdmin`. **Bypasses `/lovable/email/transactional/send`.** No `unsubscribe_token`. |
| `POST /lovable/email/queue/process` | `src/routes/lovable/email/queue/process.ts` | Dispatcher only — sends whatever is on the queues via `sendLovableEmail` | Bearer service-role auth; pg_cron driven |

## Summary Table 3 — Issues & risks

1. **`welcome` template is dead code.** Registered in `src/lib/email-templates/registry.ts` as `'welcome'` but no caller anywhere in `src/` passes that `templateName`. Two emails called "welcome" exist (`welcome` and `migration-welcome`); only `migration-welcome` is wired. Either remove `welcome.tsx` + its registry entry, or wire it (e.g. on first self-signup approval).
2. **Three senders bypass `/lovable/email/transactional/send` and therefore skip unsubscribe-footer injection and the centralised suppression/token logic.**
   - `sendWelcomeEmails` (`migration-welcome`) — does its own suppression check but **never mints/attaches `unsubscribe_token`**, so recipients of the migration blast cannot one-click unsubscribe.
   - `pick-reminder` cron — same: suppression check present, but no `unsubscribe_token` on payload. Bulk recurring email with no unsubscribe is a deliverability/compliance risk.
   - `admin-new-user` — internal admin notification; missing unsubscribe is acceptable here, but it duplicates ~80 lines of enqueue boilerplate.
3. **`admin-new-user` recipient is hardcoded inline in two places.** Template declares `to: 'rob@rjparker.co.uk'` (`src/lib/email-templates/admin-new-user.tsx:77`) and the dedupe SQL in `src/routes/api/public/hooks/new-user-signup.ts:54` also hardcodes `'rob@rjparker.co.uk'`. Changing the admin recipient requires editing both files; the dedupe query would silently break if only the template constant changes.
4. **`admin-new-user` dedupe is fragile.** Uses `email_send_log.error_message ILIKE '%${email}%'` against rows tagged `error_message: 'for=<email>'` — abuses the error column as a metadata channel and is a substring match (an email containing another email as a substring would false-positive).
5. **`admin-new-user` public endpoint has no authentication.** Anyone who knows the URL can POST `{ email: <any-existing-profile-email> }` and trigger an admin notification (rate-limited only by the 24h dedupe). The route comment claims security but the only check is "profile exists for this email".
6. **Variable mismatches.**
   - Auth `recovery` template (`src/lib/email-templates/recovery.tsx`) defines `siteName` and `firstName` props. The auth webhook (`auth/webhook.ts:208–218`) passes `firstName` from `user.user_metadata.first_name` only — fine; `siteName` is also passed. **However, `firstName` arrives only if the recovery was initiated for a user whose `user_metadata` includes `first_name`.** Recoveries initiated via `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email })` inside `sendWelcomeEmails` go through Supabase's auth hook with `user.user_metadata` populated from the existing auth user, so first-name personalisation works there — but the migration blast doesn't use the auth template, it uses `migration-welcome` directly, so the recovery template is only ever fired by explicit "forgot password" requests.
   - `signup`, `invite`, `magic-link`, `email-change`, `reauthentication` templates expect `recipient`, `oldEmail`, `newEmail`, `token`, `confirmationUrl`, `siteName`, `siteUrl`. The webhook always passes the full superset (`templateProps` at line 208), so unused props are just ignored — no runtime mismatch, but the template prop interfaces are not enforced.
   - `picks-confirmation` template `previewData.firstName = 'Rob'` is preview-only; live send reads `profile.first_name || profile.nickname`.
7. **Auth emails with no real trigger surface.** `invite`, `magic-link`, `email-change`, `reauthentication` templates exist but nothing in the app initiates these flows: `src/routes/login.tsx` uses password sign-up/sign-in only, no `inviteUserByEmail`, `signInWithOtp`, or `updateUser({ email })` calls anywhere in `src/`. They will fire only if someone triggers them from the Supabase dashboard or via a future feature.
8. **Duplicated config constants.** `SITE_NAME`, `SENDER_DOMAIN`, `FROM_DOMAIN` are duplicated literally across `auth/webhook.ts`, `transactional/send.ts`, `admin-users.functions.ts`, `new-user-signup.ts`, `pick-reminder.ts`. Drifting one will produce mismatched From headers / domain auth.
9. **`picks-confirmation` idempotency key uses `Date.now()`** (`src/lib/email/picks-confirmation.functions.ts:112`) — so it is not actually idempotent. Two rapid lineup saves will produce two confirmation emails. Same pattern in `admin-new-user-${email}-${Date.now()}`.
10. **DLQ retry counting walks `email_send_log`.** Each retry inserts a new `failed` row; the dispatcher counts them with `.in().eq('status','failed')`. This is correct but means the table grows unboundedly with no documented retention policy.
11. **`sendPicksConfirmation` builds origin from `getRequestHost()`** which on local/preview will produce a preview URL that ends up in the email body (button + plain text) — acceptable for dev, slightly noisy in QA.

---

## Per-email details

Each section pastes the **full template source verbatim** and traces the send path.

---

### 1. Confirm signup

1. **Name / type:** Confirm signup — **Auth**.
2. **Trigger:** Automatic. Supabase Auth Hook fires `action_type = "signup"` after a `supabase.auth.signUp()` call (used in `src/routes/login.tsx`) when email confirmation is required.
3. **Send path:** Supabase Go API → POSTs signed payload to `POST /lovable/email/auth/webhook` (`src/routes/lovable/email/auth/webhook.ts`). Signature verified with `LOVABLE_API_KEY` via `verifyWebhookRequest`. Template `SignupEmail` selected from `EMAIL_TEMPLATES['signup']`. Rendered to HTML + plain text and `enqueue_email('auth_emails', …)` with `from = major7s <noreply@www.major7s.com>`. Confirmation URL comes verbatim from `payload.data.url` (Supabase-minted; not a `generateLink` call here). Does **not** use the app-email send route.
4. **Template file:** `src/lib/email-templates/signup.tsx`.

```tsx
import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          !
        </Text>
        <Text style={text}>
          Please confirm your email address (
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>
          ) by clicking the button below:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Verify Email
        </Button>
        <Text style={footer}>
          If you didn't create an account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#000000', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.5', margin: '0 0 25px' }
const link = { color: 'inherit', textDecoration: 'underline' }
const button = { backgroundColor: '#000000', color: '#ffffff', fontSize: '14px', borderRadius: '8px', padding: '12px 20px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
```

5. **Variables:** `siteName` (`"major7s"` constant), `siteUrl` (`https://www.major7s.com`), `recipient` (`payload.data.email`), `confirmationUrl` (`payload.data.url`). All sourced in `auth/webhook.ts` lines 208–218. No mismatch.
6. **Subject:** `"Confirm your email"` — static (`EMAIL_SUBJECTS.signup`).
7. **Status:** Live and deployed. Template is plain black/white default styling — not branded with forest/gold like the app templates.

---

### 2. Password reset (recovery)

1. **Name / type:** Password reset — **Auth**.
2. **Trigger:** Automatic. Supabase Auth Hook fires `action_type = "recovery"` whenever:
   - A user clicks "Forgot password" → `supabase.auth.resetPasswordForEmail(…)` (if/when a UI exposes this — no caller in `src/`).
   - Admin calls `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })` — done inside `sendWelcomeEmails` (`src/lib/admin-users.functions.ts:360`). Generating a recovery link **does** trigger the auth hook, but since `sendWelcomeEmails` only uses the returned `action_link` and sends its own `migration-welcome` email, the recovery template still renders and enqueues here too unless Supabase is configured to suppress it. In practice the project's prior message history shows this as the live recovery template after the launch-copy revert.
3. **Send path:** Identical to signup: `auth/webhook.ts` selects `RecoveryEmail`. `buildConfirmationUrl()` is special-cased for `recovery` (line 80): builds `redirect_to` URL (defaults to `https://www.major7s.com/reset-password`) and appends `token_hash` + `type=recovery`.
4. **Template file:** `src/lib/email-templates/recovery.tsx`.

```tsx
import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
  firstName?: string
}

export const RecoveryEmail = ({
  confirmationUrl,
  firstName,
}: RecoveryEmailProps) => {
  const greeting = firstName && firstName.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Reset your Major7s password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Reset Your Password</Heading>
          </Section>

          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              We received a request to reset the password for your Major7s account.
              Click the button below to choose a new password.
            </Text>

            <Section style={buttonWrap}>
              <Button style={button} href={confirmationUrl}>
                Reset your password
              </Button>
            </Section>

            <Text style={footer}>
              If you didn't request a password reset, you can safely ignore this email —
              your password won't be changed.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default RecoveryEmail
/* style constants — forest #103D2E header, gold #C9A227 button — omitted here for brevity, see file */
```

5. **Variables:** `siteName` (passed but unused in the body), `confirmationUrl` (built by `buildConfirmationUrl` with `token_hash` + `type=recovery` appended to `redirect_to`), `firstName` (from `user.user_metadata.first_name`). No mismatch. Note: the file declares `fallbackLabel` / `fallbackLink` / `fallbackLinkAnchor` style constants but the JSX never renders a fallback link block (despite the original spec asking for one). Cosmetic only — the button still works.
6. **Subject:** `"Reset your password"` — static (`EMAIL_SUBJECTS.recovery`).
7. **Status:** Live. Default-style copy after the migration-welcome revert (per the project's plan history).

---

### 3. Invite

1. **Name / type:** Invite — **Auth**.
2. **Trigger:** Automatic. Supabase fires `action_type = "invite"` when `supabase.auth.admin.inviteUserByEmail(…)` is called. **No caller in `src/` invokes this** — bulk user creation goes through `bulkCreateApprovedUsers` which uses `createUser({ email_confirm: true })` instead.
3. **Send path:** `auth/webhook.ts` → `EMAIL_TEMPLATES['invite']` → `enqueue_email('auth_emails', …)`. Would fire only if an admin manually invites via the Supabase dashboard.
4. **Template file:** `src/lib/email-templates/invite.tsx`.

```tsx
import * as React from 'react'

import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text,
} from '@react-email/components'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>.
          Click the button below to accept the invitation and create your account.
        </Text>
        <Button style={button} href={confirmationUrl}>Accept Invitation</Button>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
/* same plain default styles as signup.tsx */
```

5. **Variables:** `siteName`, `siteUrl`, `confirmationUrl`. All passed by `auth/webhook.ts`. No mismatch.
6. **Subject:** `"You've been invited"` — static.
7. **Status:** **Scaffolded but unused** — no app code triggers it.

---

### 4. Magic link

1. **Name / type:** Magic link — **Auth**.
2. **Trigger:** Automatic. Supabase fires `action_type = "magiclink"` on `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })`. **No caller in `src/`.**
3. **Send path:** `auth/webhook.ts` → `EMAIL_TEMPLATES['magiclink']` → `enqueue_email('auth_emails', …)`.
4. **Template file:** `src/lib/email-templates/magic-link.tsx`.

```tsx
import * as React from 'react'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'

interface MagicLinkEmailProps { siteName: string; confirmationUrl: string }

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your login link for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your login link</Heading>
        <Text style={text}>
          Click the button below to log in to {siteName}. This link will expire shortly.
        </Text>
        <Button style={button} href={confirmationUrl}>Log In</Button>
        <Text style={footer}>
          If you didn't request this link, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
/* default plain styles */
```

5. **Variables:** `siteName`, `confirmationUrl`. No mismatch.
6. **Subject:** `"Your login link"` — static.
7. **Status:** **Scaffolded but unused.**

---

### 5. Email change

1. **Name / type:** Email change — **Auth**.
2. **Trigger:** Automatic. Supabase fires `action_type = "email_change"` on self-service `supabase.auth.updateUser({ email: newEmail })`. Admin email changes use `supabaseAdmin.auth.admin.updateUserById(id, { email, email_confirm: true })` (`src/lib/admin-users.functions.ts:61–64`) which **bypasses** the email-change confirmation. No self-service email-change UI exists in `src/`.
3. **Send path:** `auth/webhook.ts` → `EMAIL_TEMPLATES['email_change']` → `enqueue_email('auth_emails', …)`. `oldEmail` / `newEmail` pulled from payload (`email_data.old_email`, `email_data.new_email`).
4. **Template file:** `src/lib/email-templates/email-change.tsx`.

```tsx
import * as React from 'react'

import { Body, Button, Container, Head, Heading, Html, Link, Preview, Text } from '@react-email/components'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName, oldEmail, newEmail, confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email change</Heading>
        <Text style={text}>
          You requested to change your email address for {siteName} from{' '}
          <Link href={`mailto:${oldEmail}`} style={link}>{oldEmail}</Link>{' '}
          to{' '}
          <Link href={`mailto:${newEmail}`} style={link}>{newEmail}</Link>.
        </Text>
        <Text style={text}>Click the button below to confirm this change:</Text>
        <Button style={button} href={confirmationUrl}>Confirm Email Change</Button>
        <Text style={footer}>
          If you didn't request this change, please secure your account immediately.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
/* default plain styles */
```

5. **Variables:** `siteName`, `oldEmail`, `email`, `newEmail`, `confirmationUrl`. `email` is destructured in the props interface but **not used** in JSX (only `oldEmail` and `newEmail` are rendered). No mismatch with the webhook payload.
6. **Subject:** `"Confirm your new email"` — static.
7. **Status:** **Scaffolded; fires only on self-service email change, which the app doesn't expose.**

---

### 6. Reauthentication

1. **Name / type:** Reauthentication — **Auth**.
2. **Trigger:** Automatic. Supabase fires `action_type = "reauthentication"` when `supabase.auth.reauthenticate()` is called (used e.g. before password update without current password). **No caller in `src/`.**
3. **Send path:** `auth/webhook.ts` → `EMAIL_TEMPLATES['reauthentication']`. `token` sourced from `email_data.token`.
4. **Template file:** `src/lib/email-templates/reauthentication.tsx`.

```tsx
import * as React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'

interface ReauthenticationEmailProps { token: string }

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm reauthentication</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request this, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
/* default plain styles + monospace code block */
```

5. **Variables:** `token`. Sourced from `emailData.token` in webhook. No mismatch.
6. **Subject:** `"Your verification code"` — static.
7. **Status:** **Scaffolded but unused.**

---

### 7. Admin: new user signup

1. **Name / type:** Admin notification — **App**.
2. **Trigger:** Automatic, fire-and-forget from the client. In `src/routes/login.tsx:78–82`, immediately after a successful `supabase.auth.signUp(…)`:
   ```ts
   void fetch("/api/public/hooks/new-user-signup", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ email }),
   }).catch((err) => console.warn("admin-new-user notification failed", err));
   ```
3. **Send path:** `POST /api/public/hooks/new-user-signup` (`src/routes/api/public/hooks/new-user-signup.ts`). No signature verification — only validates that a `profiles` row exists for the given email. Dedupes against `email_send_log` for the last 24h via the recipient-pinned `'rob@rjparker.co.uk'` and a substring-match on `error_message` tagged `for=<email>`. Renders `admin-new-user` template, suppression-checks `rob@rjparker.co.uk`, then enqueues directly via `supabaseAdmin.rpc('enqueue_email', { queue_name: 'transactional_emails', payload })`. **Bypasses `/lovable/email/transactional/send`** and therefore the unsubscribe-token mechanism.
4. **Template file:** `src/lib/email-templates/admin-new-user.tsx`.

```tsx
import * as React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Row, Column, Hr, Link,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  nickname?: string
  fullName?: string
  email?: string
  phone?: string
  referralName?: string
  teamNickname?: string
  signedUpAt?: string
  adminUrl?: string
}

const AdminNewUserEmail = ({
  nickname, fullName, email, phone, referralName, teamNickname, signedUpAt, adminUrl,
}: Props) => {
  const url = adminUrl?.trim() || 'https://www.major7s.com/admin'
  const rows: Array<[string, string | undefined]> = [
    ['Nickname', nickname],
    ['Full name', fullName],
    ['Email', email],
    ['Phone', phone],
    ['Team', teamNickname],
    ['Referred by', referralName],
    ['Signed up', signedUpAt],
  ]
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`New Major7s signup: ${nickname || fullName || email || 'unknown'}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>New Major7s Signup</Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>A new player just created an account and is awaiting approval.</Text>
            <Section style={table}>
              {rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => (
                <Row key={k} style={tr}>
                  <Column style={th}>{k}</Column>
                  <Column style={td}>{v}</Column>
                </Row>
              ))}
            </Section>
            <Text style={text}>
              Approve or review in the <Link href={url} style={anchor}>admin panel</Link>.
            </Text>
            <Hr style={hr} />
            <Text style={footer}>You're receiving this because you're the Major7s admin.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AdminNewUserEmail,
  subject: (d: Record<string, any>) =>
    `New Major7s signup: ${d.nickname || d.fullName || d.email || 'unknown'}`,
  displayName: 'Admin: new user signup',
  to: 'rob@rjparker.co.uk',
  previewData: { /* sample row */ },
} satisfies TemplateEntry
```

5. **Variables (sourced in `new-user-signup.ts:90–99`):**
   - `nickname` ← `profiles.nickname`
   - `fullName` ← `[profiles.first_name, profiles.last_name].filter(Boolean).join(' ')`
   - `email` ← `profiles.email`
   - `phone` ← `profiles.phone`
   - `referralName` ← `profiles.referral_name`
   - `teamNickname` ← `profiles.team_nickname`
   - `signedUpAt` ← formatted `profiles.created_at`
   - `adminUrl` ← `${request origin}/admin`
   - **Recipient:** template-level `to: 'rob@rjparker.co.uk'` — caller cannot override.
   - **Mismatch:** none structural. Hardcoded recipient duplicated in dedupe SQL (see Issues #3).
6. **Subject:** Dynamic — `New Major7s signup: <nickname|fullName|email|"unknown">`.
7. **Status:** Live.

---

### 8. Migration welcome

1. **Name / type:** Migration welcome — **App**.
2. **Trigger:** Admin-triggered. Admin Users tab (`src/components/admin/users-directory-tab.tsx`) exposes per-user and bulk "Send welcome" actions wired to the server function `sendWelcomeEmails` via `useServerFn(sendWelcomeEmails)`.
3. **Send path (`src/lib/admin-users.functions.ts:309–439`):**
   1. `requireSupabaseAuth` + `assertAdmin`.
   2. Chunk-load `profiles { id, email, first_name }` for input userIds.
   3. For each user: suppression check on `suppressed_emails`. If suppressed → record `failed: 'Email suppressed'` and continue.
   4. `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: data.redirectTo } })` — mints a recovery action link without sending Supabase's own recovery email body to render (the auth hook will still receive the recovery event; see Issues §6/§7).
   5. Render `migrationWelcomeTemplate.component` with `{ firstName: profile.first_name?.trim() || undefined, setPasswordUrl: linkData.properties.action_link }`.
   6. `supabaseAdmin.rpc('enqueue_email', { queue_name: 'transactional_emails', payload: { … no unsubscribe_token … } })`.
   7. Inserts `admin_audit { action: 'user.welcome_sent', detail: { requested, sent, failed } }`.
   - Bypasses `/lovable/email/transactional/send` → no centralised unsubscribe token, but does its own suppression check.
4. **Template file:** `src/lib/email-templates/migration-welcome.tsx`.

```tsx
import * as React from 'react'

import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text,
} from '@react-email/components'

import type { TemplateEntry } from './registry'

interface MigrationWelcomeProps {
  firstName?: string
  setPasswordUrl: string
}

const MigrationWelcomeEmail = ({ firstName, setPasswordUrl }: MigrationWelcomeProps) => {
  const greeting = firstName && firstName.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const url = setPasswordUrl && setPasswordUrl.trim() ? setPasswordUrl : 'https://www.major7s.com/welcome'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Major7s.com is live — set your password to get back in.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Major7s.com Is Live. Tweaked, Upgraded.</Heading>
          </Section>

          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>Major7s has moved to a brand-new home.</Text>
            <Text style={text}>
              Your account is already set up. We've pre-loaded your details and your full
              picks history, so everything from previous years is waiting for you —
              nothing to re-enter.
            </Text>
            <Text style={text}>
              There's one thing left to do: set a password and you're ready to play.
            </Text>

            <Section style={buttonWrap}>
              <Button style={button} href={url}>Set your password</Button>
            </Section>

            <Text style={fallbackLabel}>Button not working? Use this link:</Text>
            <Text style={fallbackLink}>
              <Link href={url} style={fallbackLinkAnchor}>{url}</Link>
            </Text>

            <Text style={footer}>
              You're receiving this because you have previously played Major7s. If you
              weren't expecting it, you can safely ignore this email — no account changes
              will be made until you set a password.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MigrationWelcomeEmail,
  subject: "You're in — set up your Major7s account",
  displayName: 'Migration welcome',
  previewData: { firstName: 'Jamie', setPasswordUrl: 'https://www.major7s.com/welcome' },
} satisfies TemplateEntry
/* forest #103D2E header, gold #C9A227 button styles */
```

5. **Variables:**
   - `firstName` ← `profiles.first_name?.trim() || undefined`. Fallback "Hi there,". (Hardened previously per chat history.)
   - `setPasswordUrl` ← `generateLink({ type: 'recovery' }).properties.action_link`, with `redirectTo` from the admin caller (the admin UI must pass a `/welcome` URL).
   - No mismatch. `previewData.firstName = 'Jamie'` is preview-only and never reaches the live send path.
6. **Subject:** `"You're in — set up your Major7s account"` — static.
7. **Status:** Live. Bypasses centralised send route → **no unsubscribe footer** is injected by the gateway (Issues #2).

---

### 9. Pick deadline reminder

1. **Name / type:** Pick reminder — **App**.
2. **Trigger:** Cron. `pg_cron` POSTs `/api/public/hooks/pick-reminder` every ~30 min, gated by `apikey` header == `SUPABASE_PUBLISHABLE_KEY`. Fires for each tournament whose `submission_deadline` is in the 2h45m–3h15m window, for each approved user with a primary team and zero picks for that tournament.
3. **Send path:** Public route → for each (tournament, profile) pair: suppression check, render `pick-reminder` template, `supabaseAdmin.rpc('enqueue_email', { queue_name: 'transactional_emails', payload: { … no unsubscribe_token … } })`. **Bypasses `/lovable/email/transactional/send`.** `idempotency_key = pick-reminder-<tournamentId>-<profileId>` — proper idempotency (one per user per tournament, ever).
4. **Template file:** `src/lib/email-templates/pick-reminder.tsx`.

```tsx
import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  firstName?: string
  tournamentName?: string
  deadline?: string
  tournamentUrl?: string
}

const PickReminderEmail = ({ firstName, tournamentName, deadline, tournamentUrl }: Props) => {
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const name = tournamentName?.trim() || 'the next tournament'
  const url = tournamentUrl?.trim() || 'https://www.major7s.com'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`Picks lock soon for ${name}.`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Picks Lock Soon</Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              Heads up — picks for <strong>{name}</strong> lock in about 3 hours and we
              don't have a lineup from you yet.
            </Text>
            {deadline?.trim() ? <Text style={meta}>Picks lock: {deadline}</Text> : null}
            <Section style={buttonWrap}>
              <Button style={button} href={url}>Make Your Picks</Button>
            </Section>
            <Hr style={hr} />
            <Text style={footer}>
              Already submitted? You can ignore this — there's a slight delay between
              picks landing and reminders going out.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: PickReminderEmail,
  subject: (d: Record<string, any>) =>
    `Picks lock in 3 hours — ${d.tournamentName || 'Major7s'}`,
  displayName: 'Pick deadline reminder',
  previewData: { firstName: 'Rob', tournamentName: 'The Masters', deadline: 'Thu, Apr 10 · 7:00 AM ET', tournamentUrl: 'https://www.major7s.com' },
} satisfies TemplateEntry
/* forest/gold brand styles */
```

5. **Variables (sourced in `pick-reminder.ts:122–127`):**
   - `firstName` ← `profiles.first_name || profiles.nickname`
   - `tournamentName` ← `tournaments.name`
   - `deadline` ← formatted `tournaments.submission_deadline`
   - `tournamentUrl` ← `${request origin}/tournament/<id>`
   - No mismatch.
6. **Subject:** Dynamic — `Picks lock in 3 hours — <tournamentName | "Major7s">`.
7. **Status:** Live. Recurring bulk app email with **no unsubscribe footer** (Issues #2) — flag for compliance review.

---

### 10. Picks confirmation

1. **Name / type:** Picks confirmation — **App**.
2. **Trigger:** Automatic. After a successful lineup save in `src/routes/_authenticated/tournament.$id.lineup.tsx` (call sites around lines 1659–1668), the client calls server fn `sendPicksConfirmation` fire-and-forget. Skipped when an admin is impersonating.
3. **Send path:** `sendPicksConfirmation` (`src/lib/email/picks-confirmation.functions.ts`) → loads user email, tournament, picks, golfer names server-side → internal `fetch('/lovable/email/transactional/send', { Authorization: <caller's bearer token> })`. This is the **only** sender that uses the centralised send route → suppression, unsubscribe token, and footer injection all apply.
4. **Template file:** `src/lib/email-templates/picks-confirmation.tsx`.

```tsx
import * as React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Button, Row, Column, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface PickRow { bucket: number; golfer: string }
interface Props {
  firstName?: string
  tournamentName?: string
  picks?: PickRow[]
  isUpdate?: boolean
  tournamentUrl?: string
  deadline?: string
  tweakCount?: number
}

const PicksConfirmationEmail = ({
  firstName, tournamentName, picks, isUpdate, tournamentUrl, deadline, tweakCount,
}: Props) => {
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const name = tournamentName?.trim() || 'the tournament'
  const url = tournamentUrl?.trim() || 'https://www.major7s.com'
  const action = isUpdate ? 'updated' : 'locked in'
  const rows = picks ?? []
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`Your ${name} picks are ${isUpdate ? 'updated' : 'in'}.`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>{isUpdate ? 'Picks Updated' : 'Picks Confirmed'}</Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              You've {action} your lineup for <strong>{name}</strong>. Here's what we have on file:
            </Text>
            <Section style={pickTable}>
              {rows.map((p) => (
                <Row key={p.bucket} style={pickRow}>
                  <Column style={bucketCol}>Tier {p.bucket}</Column>
                  <Column style={golferCol}>{p.golfer}</Column>
                </Row>
              ))}
            </Section>
            {typeof tweakCount === 'number' && tweakCount > 0
              ? <Text style={meta}>Tweaks used: {tweakCount}</Text> : null}
            {deadline?.trim() ? <Text style={meta}>Picks lock: {deadline}</Text> : null}
            <Section style={buttonWrap}>
              <Button style={button} href={url}>View Tournament</Button>
            </Section>
            <Hr style={hr} />
            <Text style={footer}>You can still tweak your picks until the deadline. Good luck.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: PicksConfirmationEmail,
  subject: (d: Record<string, any>) =>
    `${d.isUpdate ? 'Picks updated' : 'Picks confirmed'} — ${d.tournamentName || 'Major7s'}`,
  displayName: 'Picks confirmation',
  previewData: { firstName: 'Rob', tournamentName: 'The Masters', isUpdate: false, tweakCount: 0,
    deadline: 'Thu, Apr 10 · 7:00 AM ET', tournamentUrl: 'https://www.major7s.com',
    picks: [{ bucket: 1, golfer: 'Scottie Scheffler' }, { bucket: 2, golfer: 'Rory McIlroy' },
      { bucket: 3, golfer: 'Xander Schauffele' }, { bucket: 4, golfer: 'Ludvig Aberg' }] },
} satisfies TemplateEntry
/* forest/gold brand styles + table styles */
```

5. **Variables (sourced in `picks-confirmation.functions.ts:113–121`):**
   - `firstName` ← `profile.first_name || profile.nickname`
   - `tournamentName` ← `tournaments.name`
   - `isUpdate` ← caller-supplied boolean
   - `tweakCount` ← caller-supplied number
   - `deadline` ← formatted `tournaments.submission_deadline`
   - `tournamentUrl` ← `${origin}/tournament/<id>` (origin from `getRequestHost()`)
   - `picks` ← `picks { bucket, golfer_id }` joined to `golfers.name`
   - No mismatch.
6. **Subject:** Dynamic — `<"Picks updated"|"Picks confirmed"> — <tournamentName | "Major7s">`.
7. **Status:** Live. Only app email that benefits from the central suppression + unsubscribe pipeline.

---

### 11. Welcome (generic)

1. **Name / type:** Welcome — **App**.
2. **Trigger:** **None.** Template is registered as `'welcome'` in `src/lib/email-templates/registry.ts` but `rg "templateName.*welcome|'welcome'"` over `src/` finds zero call sites passing this name to the send route or directly enqueueing it.
3. **Send path:** N/A.
4. **Template file:** `src/lib/email-templates/welcome.tsx`.

```tsx
import * as React from 'react'

import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface WelcomeEmailProps { firstName?: string; appUrl?: string }

const WelcomeEmail = ({ firstName, appUrl }: WelcomeEmailProps) => {
  const greeting = firstName && firstName.trim() ? `Welcome, ${firstName.trim()}!` : 'Welcome!'
  const url = appUrl && appUrl.trim() ? appUrl : 'https://www.major7s.com'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Welcome to Major7s — you're in.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Welcome To Major7s</Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              Your account is ready. Major7s is where the crew picks majors, tracks the
              leaderboard, and settles scores year after year.
            </Text>
            <Text style={text}>
              Jump in, make your picks before the next deadline, and keep an eye on the
              leaderboard as the tournament unfolds.
            </Text>
            <Section style={buttonWrap}>
              <Button style={button} href={url}>Open Major7s</Button>
            </Section>
            <Text style={footer}>
              You're receiving this because an account was created for you on Major7s. If
              that wasn't you, just ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeEmail,
  subject: 'Welcome to Major7s',
  displayName: 'Welcome',
  previewData: { firstName: 'Rob', appUrl: 'https://www.major7s.com' },
} satisfies TemplateEntry
/* forest/gold brand styles */
```

5. **Variables:** `firstName`, `appUrl` — no caller.
6. **Subject:** `"Welcome to Major7s"` — static.
7. **Status:** **Scaffolded-but-unused.** Likely a leftover from the migration plan. Decision needed: delete, or wire it (e.g. as the post-approval welcome for net-new self-signups, distinct from the `migration-welcome` used for pre-provisioned users).

---

## Welcome vs migration-welcome — which to keep?

| Aspect | `welcome` | `migration-welcome` |
|---|---|---|
| Audience | Net-new self-signup (account just created, password already set) | Pre-existing player carried over from the old Major7s site (account exists, no password yet) |
| Headline | "Welcome To Major7s" | "Major7s.com Is Live. Tweaked, Upgraded." |
| Primary CTA | "Open Major7s" → `appUrl` (homepage) | "Set your password" → recovery `action_link` |
| Greeting | `Welcome, {firstName}!` | `Hi {firstName},` |
| Used by | **No caller** | `sendWelcomeEmails` (admin Users tab) |
| Brand styling | Forest + gold | Forest + gold |

They serve different jobs and are not redundant in intent, but `welcome` is currently dead. Recommended action: keep both **only if** a "new self-signup welcome" trigger is planned (e.g. fire on admin approval of a `pending` profile). Otherwise delete `welcome.tsx` and its registry entry.
