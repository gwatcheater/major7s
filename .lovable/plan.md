## Findings (no code changed)

### 1. Where the trigger fires
`src/routes/login.tsx` line 78, immediately after a successful `supabase.auth.signUp()`:

```ts
void fetch("/api/public/hooks/new-user-signup", {
  method: "POST", headers: {...},
  body: JSON.stringify({ email }),
}).catch(...);
// Then: await supabase.auth.signOut(); setPendingMsg(...); setMode("signin");
```

It's fire-and-forget (`void`, no `await`). It can be lost if:
- The user closes the tab / navigates away before the request reaches the server.
- The browser is offline or the network drops.
- Email confirmation is enabled (it isn't right now — `signOut()` runs immediately after), but any future flip would race the same way.
- The browser kills in-flight requests on unload (no `keepalive: true` set).
- An unhandled error throws between `signUp` and the `fetch` (none today, but fragile).

### 2. What actually happened for footbolt@gmail.com

The client fetch DID fire and the endpoint DID enqueue. From `email_send_log`:

```
message_id b44051a1-… (template admin-new-user, recipient rob@rjparker.co.uk, for=footbolt@gmail.com)
  2026-06-22 07:47:48  pending   ← enqueued OK
  2026-06-24 18:56:52  dlq       ← TTL exceeded (60 minutes)
```

Six other admin-new-user notifications from 06/21–06/22 (mary.thorp, pridaym, michael_miraglia, lholmes1481, finlaysaunders, bpurkiss) show the exact same two-row pattern: `pending` on signup day, then bulk `dlq / TTL exceeded` at 2026-06-24 18:56:52.

The queue processor was effectively not running between 06/22 and 06/24 18:56. When it finally ran today, every admin-new-user message was already older than the 60-minute `transactional_email_ttl_minutes`, so `process.ts` moved them all straight to DLQ without ever attempting a send. No 4xx/5xx from the email provider for footbolt — the send was never attempted.

Earlier evidence the message would also have failed if it had been processed in time: on 2026-06-19 the same template hit DLQ with `Email API error: 400 {"type":"missing_unsubscribe","message":"Transactional emails must include an unsubscribe_token"}`. The enqueue payload in `src/routes/api/public/hooks/new-user-signup.ts` sets `purpose: 'transactional'` but never sets `unsubscribe_token`. So this template has two compounding faults.

### 3. Endpoint code-path walk for footbolt

`src/routes/api/public/hooks/new-user-signup.ts` POST handler:
1. Zod-parses `{ email }` → OK.
2. `supabaseAdmin.from('profiles').select(...).eq('email', email).maybeSingle()` — profile existed (`handle_new_user` trigger creates it inside the same `auth.users` insert transaction, so by the time the client `fetch` lands the profile row is committed). Confirmed: profile `e112b367…` for footbolt with `created_at 2026-06-22 07:47:46` (≈2s before the log row).
3. 24h dedupe via `ilike error_message %email%` — no prior row, not skipped.
4. Suppression check — not suppressed.
5. Inserts `pending` log row with `error_message = 'for=footbolt@gmail.com'` (this is the row we see).
6. `supabaseAdmin.rpc('enqueue_email', { queue_name: 'transactional_emails', payload: { …, purpose:'transactional', label:'admin-new-user', idempotency_key: \`admin-new-user-${email}-${Date.now()}\`, NO unsubscribe_token … } })` — succeeded.

So the endpoint did its job. The failure is downstream (queue not draining + missing `unsubscribe_token` on the payload).

### 4. Root cause and minimal fix

**Root cause (primary):** The `process-email-queue` cron job did not drain `transactional_emails` between 06/22 and 06/24. Messages exceeded the 60-minute TTL and were DLQ'd in bulk. This was not a trigger problem and not a client-fetch problem.

**Root cause (latent):** Even if the processor had run on time, the admin-new-user payload is missing `unsubscribe_token`, which the Lovable email API rejects for `purpose: 'transactional'` (proven by the 06/19 failures on this same template). Every send attempt would have 400'd and DLQ'd after 5 retries.

**Reliability concern (real, but not the cause here):** the client `fetch` is fragile for the reasons in §1 and should not stay on the client.

### Minimal fix plan

1. **Re-provision prod email cron.** Call `email_domain--setup_email_infra` so the `process-email-queue` pg_cron job is present and points at the deployed `/lovable/email/queue/process` route. Verify by watching `email_send_log` for new `sent` rows within 5–10s of the next enqueue.

2. **Fix the admin-new-user enqueue payload** in `src/routes/api/public/hooks/new-user-signup.ts`:
   - Either route this template through `/lovable/email/transactional/send` (which mints the unsubscribe token and footer for you) instead of hand-rolling the enqueue, OR
   - Mint/lookup an `unsubscribe_token` for `rob@rjparker.co.uk` from `email_unsubscribe_tokens` and include it in the payload.
   - Send route is the better choice because it also fixes the missing unsubscribe footer flagged in `docs/email-handover.md`.

3. **Move the trigger off the browser.** Replace the `void fetch(...)` in `src/routes/login.tsx` with a server-side trigger so a closed tab / dropped request can't lose the notification. Two options:
   - **Preferred — DB trigger on `public.profiles` insert.** Add an `AFTER INSERT` trigger that calls `enqueue_email('transactional_emails', payload)` with the same payload the route builds today. The `handle_new_user()` trigger already creates the profile in the same txn as `auth.users` insert, so this fires reliably for every real signup. Keep the dedupe via `idempotency_key` (drop the `Date.now()` — use a stable key like `admin-new-user-${profile_id}`). The HTML body can be pre-rendered server-side by a small server function the trigger calls via `pg_net`, or — simpler — switch to a tiny server-side polling job that renders + sends for any profile without a matching `email_send_log` row.
   - **Alternative — call the same logic from a server function invoked inside the signup flow's post-signup callback** (still server-side, not browser-side). Less robust than a DB trigger because it still depends on the client reaching a server function once.
   - In either case, delete the `void fetch(...)` from `login.tsx`.

4. **Backfill footbolt + the other 6 missed signups.** One-off: re-enqueue admin-new-user for each `email_send_log` row with `template_name='admin-new-user'`, `status='dlq'`, `error_message LIKE 'TTL exceeded%'` whose original `for=…` user is still in `profiles`. Stable idempotency key prevents future duplicates.

### Suggested order
1, 2, 4 first (restores correctness for current and recent signups). Then 3 (hardens against future client-side losses). No schema changes needed for 1/2/4; 3 adds one trigger + a small renderer path.
