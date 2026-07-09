# Technical Assessment — Admin-Managed Password Migration

This is a findings report, not an implementation plan. No files change until you pick a direction.

## 1. Edge Functions

- **Deploy custom Supabase Edge Functions?** Partial. This project is TanStack Start on Cloudflare Workers. Lovable's guidance is: **do NOT use Supabase Edge Functions for app-internal logic**. Use `createServerFn` (typed RPC) or a server route under `src/routes/api/` (raw HTTP, webhooks). Edge Functions are only appropriate for externally-called webhooks that must land in Supabase's network. For your use case (admin bulk action) — use `createServerFn`, not an Edge Function.
- **Service role from a server function?** Yes. `supabaseAdmin` from `@/integrations/supabase/client.server` uses the service role and can call `auth.admin.updateUserById()` and `auth.admin.generateLink()`. Must be `await import(...)`ed **inside** the handler of a `*.functions.ts` file (module-scope import leaks to the client bundle).
- **Restrictions on admin auth methods?** No Lovable-imposed restriction on the Auth Admin API surface — full `auth.admin.*` is available via the service role client. The constraint is authorization: the server fn must verify the caller (`requireSupabaseAuth` + `has_role(_, 'admin')`) or it becomes a public endpoint on the published site.

## 2. Service Role Key Access

- **Direct access?** No. The service role key is fully managed. You cannot read, echo, or export `SUPABASE_SERVICE_ROLE_KEY`, and you cannot access the Supabase dashboard or DB password. It is auto-injected into the server runtime as `process.env.SUPABASE_SERVICE_ROLE_KEY`, consumed only by `supabaseAdmin`.
- **Lovable-native way to do bulk admin actions?** Yes — an admin-gated `createServerFn` that uses `supabaseAdmin` server-side. That is the supported pattern; you never handle the key yourself. There is no separate "bulk users" UI in Lovable Cloud to lean on.

## 3. Auth Table Access

- **Alter `profiles` (add `requires_password_reset boolean`)?** Yes. Standard `supabase--migration` — remember `GRANT`s + RLS policy + `service_role` grant.
- **Query/join `auth.users` directly?** Partial. Read-only via server functions using `supabaseAdmin` (`.schema('auth').from('users')` or Auth Admin API `listUsers`). You must **not** write to, add triggers on, or otherwise mutate the `auth` schema — that's a hard Lovable rule. Joining in SQL from `public` views/functions is fine as long as you don't modify `auth`.

## 4. Custom Auth Logic

- **Intercept post-login and force-redirect?** Yes. The pattern already exists in this codebase: `OnboardingGate` (`src/components/onboarding-gate.tsx`) reads a profile flag and redirects to `/welcome`. Add `requires_password_reset` to that same gate (or a sibling), wrapping `<Outlet />` inside `src/routes/_authenticated.tsx`.
- **Lovable-specific protected routing pattern?** Yes. TanStack file-based routing under `src/routes/_authenticated/` is the integration-managed gate (`ssr: false`, redirects to `/login`). Don't write a custom `ProtectedRoute` HOC. Conditional flags layer on top via a component gate (like `OnboardingGate`) inside that layout. Keep `/reset-password` and `/welcome` OUTSIDE `_authenticated/` to avoid redirect loops.

## 5. Admin Panel Actions

- **Loop over 100+ users setting a temp password?** Yes, technically supported via `supabaseAdmin.auth.admin.updateUserById()` in a loop from an admin-gated `createServerFn`. Caveats:
  - Cloudflare Worker request has a wall-clock budget; ~100 users is fine sequentially, but for larger sets batch/paginate and consider a queue table + cron.
  - Setting the **same** temp password for many users is a real security concern — prefer minting per-user recovery links (`generateLink({ type: 'recovery' })`) and emailing them, which is what the existing "migration welcome" flow in `src/lib/admin-users.functions.ts` already does. Reusing that pattern is strongly recommended over shared temp passwords.
- **Built-in Lovable admin/user management?** Partial. Cloud → Users lets you view/delete users manually, but there is no bulk password/reset UI. Your existing `/admin` console + `admin-users.functions.ts` is the right home.

## 6. Known Limitations

- **Bulk user creation:** allowed via `supabaseAdmin.auth.admin.createUser` in a server fn; no Lovable throttle beyond Supabase's own rate limits and Worker CPU/time limits.
- **Password management:** full Auth Admin API access via service role; no Lovable restriction.
- **Custom email sending (bypassing Supabase mailer):** Fully supported and already wired. Lovable Emails infrastructure lives at `src/routes/lovable/email/*` and `src/lib/email-templates/*`, sending via `LOVABLE_API_KEY`. Auth emails go through the auth webhook (`/lovable/email/auth/webhook`); transactional emails go through the queue (`enqueue_email` → `process`). Use this, not `supabase.auth.resetPasswordForEmail`'s default template flow, if you want the branded template.
- **Direct `auth.admin` API access:** allowed server-side via `supabaseAdmin`. Not accessible from the browser (and shouldn't be).
- **Hard blocks:** no Supabase dashboard access, no DB password, no service-role key exposure, no schema changes to `auth`/`storage`/`realtime`/`supabase_functions`/`vault`, no triggers on those schemas, no editing auto-generated integration files.

## Verdict on your proposed stack

| Proposed piece | Verdict | Lovable-native replacement |
|---|---|---|
| Edge Functions | Wrong tool | `createServerFn` in `src/lib/*.functions.ts` |
| Service role key handling | Not accessible | `supabaseAdmin` (server-only), loaded inside handler |
| `profiles.requires_password_reset` flag | Fine | Migration with GRANTs + RLS; mirror the existing `onboarded_at` pattern |
| Custom `ProtectedRoute` login interception | Wrong pattern | Add a gate component alongside `OnboardingGate` inside `_authenticated` layout |
| Shared temp password for all users | Discouraged | Per-user recovery link via `generateLink` + branded migration email (already implemented for `sendWelcomeEmails`) |

## Recommended Shape (if you proceed)

1. Migration: add `profiles.requires_password_reset boolean not null default false` (+ index if you'll filter on it).
2. Admin server fn (`src/lib/admin-users.functions.ts`) — `requireSupabaseAuth` + `has_role('admin')` — that either:
   - **(a) Recommended:** iterates target users, calls `auth.admin.generateLink({ type: 'recovery' })`, enqueues the migration-welcome email, and sets `requires_password_reset = true`; or
   - **(b) If shared temp password is a hard requirement:** iterates, calls `auth.admin.updateUserById(id, { password: TEMP })`, sets `requires_password_reset = true`.
3. Reuse `/reset-password` (public route) for the actual password change; on success clear the flag via a server fn.
4. New `PasswordResetGate` component inside `src/routes/_authenticated.tsx` (same shape as `OnboardingGate`) that redirects to `/reset-password` when the flag is true.
5. Admin UI button in the users tab wired via `useServerFn`.

Tell me which direction — (a) recovery links (recommended) or (b) shared temp password — and I'll write the implementation plan.
