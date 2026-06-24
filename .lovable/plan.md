## Answer to your question

**Migration-welcome WILL hit the same 400.** Same code shape as the old admin-new-user hook: `purpose: 'transactional'` enqueued via `enqueue_email` with no `unsubscribe_token`.

**Why your test "delivered" but admin-new-user 400'd:** it didn't. `email_send_log` has zero rows for `template_name='migration-welcome'` — the only template ever logged is `admin-new-user` (84 rows). Either the test never actually invoked `sendWelcomeEmails` end-to-end, or it ran before this code path existed. There is no successful send to point at.

**Enforcement scope:** global, keyed on `purpose`. The 400 body — `{"type":"missing_unsubscribe","message":"Transactional emails must include an unsubscribe_token"}` — is emitted by the Lovable email API for any payload with `purpose: 'transactional'` and no `unsubscribe_token`, regardless of template or recipient. Not per-template, not per-message-class beyond `purpose`. So every direct-enqueue path in this codebase that sets `purpose: 'transactional'` and skips the token is broken; only `/lovable/email/transactional/send` mints it correctly. That covers: admin-new-user (now fixed), migration-welcome (NOT fixed), pick-reminder (also direct enqueue — needs same fix, flagged in the handover doc).

## Plan — fix before publish

### Scope
Apply the same mint-or-reuse logic to `src/lib/admin-users.functions.ts` `sendWelcomeEmails` so migration-welcome can never 400 on publish.

### Edit: `src/lib/admin-users.functions.ts` (sendWelcomeEmails, around line 384)

Insert between the suppression check and the `email_send_log` pending insert:

```ts
// Resolve unsubscribe token for the recipient — required by the email API
// for purpose:'transactional'. Mirror /lovable/email/transactional/send.
const normalizedEmail = email.toLowerCase();
let unsubscribeToken: string;
const { data: existingToken } = await supabaseAdmin
  .from("email_unsubscribe_tokens")
  .select("token, used_at")
  .eq("email", normalizedEmail)
  .maybeSingle();
if (existingToken && !existingToken.used_at) {
  unsubscribeToken = existingToken.token;
} else {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const newToken = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .upsert(
      { token: newToken, email: normalizedEmail },
      { onConflict: "email", ignoreDuplicates: true },
    );
  const { data: stored } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", normalizedEmail)
    .maybeSingle();
  unsubscribeToken = stored?.token ?? newToken;
}
```

Then add `unsubscribe_token: unsubscribeToken,` to the `payload` object in the existing `enqueue_email` call (around line 405).

### Out of scope for this turn (flag only)
`pick-reminder` (`src/routes/api/public/hooks/pick-reminder.ts`) has the same shape. Not in your "before I publish" question, but it will 400 the next time it fires. Recommend fixing it the same way in a follow-up.

### Verify
After publish, trigger one migration-welcome send to a real recipient and confirm the resulting `email_send_log` row reaches `status='sent'`, not `status='failed'` with `missing_unsubscribe`.
