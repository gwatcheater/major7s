# Plan — fix `missing_unsubscribe` in two more send paths, then verify

## 1. `src/lib/admin-users.functions.ts` — `sendWelcomeEmails`
This was outlined last turn but not landed. Insert the mint-or-reuse block right before the `email_send_log` pending insert, and add `unsubscribe_token: unsubscribeToken,` to the `enqueue_email` payload. Logic mirrors `/lovable/email/transactional/send`:

- Lower-case `email`.
- `select token, used_at from email_unsubscribe_tokens where email = ? maybeSingle()`.
- If row exists and `used_at` is null → reuse.
- Else generate 32 random bytes (`crypto.getRandomValues`) → hex → upsert `{ token, email }` with `onConflict: "email", ignoreDuplicates: true`, then re-select to get the canonical token (handles race where another concurrent insert won).
- Add `unsubscribe_token` to the enqueue payload.

No other behavior changes (recovery link generation, render, suppression check, message_id, idempotency_key all unchanged).

## 2. `src/routes/api/public/hooks/pick-reminder.ts`
Same defect — `purpose: 'transactional'` enqueued with no token. Apply the same mint-or-reuse block inside the per-recipient loop (just before the `email_send_log` pending insert), and add `unsubscribe_token: unsubscribeToken,` to the payload. Per-recipient placement is correct because the token must match the specific recipient.

## 3. Verify both fixes build, then publish
Both routes ship at publish-time. The published build is still the old code, so re-sending against the live host will keep 400'ing until publish completes. Plan:

1. Apply the two file edits.
2. Ask the user to publish (the 400s will persist until the new code is live).
3. After publish, re-run the backfill against the live host:
   - 7 admin-new-user signups: `mary.thorp`, `pridaym`, `footbolt@gmail.com`, `bpurkiss`, `michael_miraglia`, `lholmes1481`, `finlaysaunders` → POST each to `/api/public/hooks/new-user-signup`.
   - 1 migration-welcome: trigger `sendWelcomeEmails` for `freddie@rjparker.co.uk`.
4. Query `email_send_log` (deduped by `message_id`) for these 8 recipients and confirm `status = 'sent'`, not `failed/missing_unsubscribe`. Show the rows.

## 4. Report
Paste the final `sendWelcomeEmails` function source and the verification table.

## Out of scope
No template changes, no schema changes, no changes to the DB trigger or the new-user-signup hook (already fixed).
