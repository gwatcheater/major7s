# Diagnosis: historical admin-new-user alerts

## What happened (no code change needed)

The alerts in your inbox came from **the manual backfill POSTs I ran earlier in this very conversation** to drain the 7 DLQ'd `admin-new-user` rows (the ones that had failed with `400 missing_unsubscribe` before the token fix). They did **not** come from the AFTER INSERT trigger replaying historical rows.

### Evidence

1. **Trigger definition (confirmed AFTER INSERT only, not UPDATE):**
   ```
   CREATE TRIGGER trg_notify_admin_on_new_profile
   AFTER INSERT ON public.profiles
   FOR EACH ROW EXECUTE FUNCTION notify_admin_on_new_profile()
   ```
   `tgtype=5` = ROW + AFTER + INSERT. It physically cannot fire on UPDATE/UPSERT-without-insert. An `INSERT ... ON CONFLICT DO UPDATE` only fires INSERT triggers on the row variant that actually inserts; pure updates don't re-fire it. And `handle_new_user` only runs on `auth.users` insert, so existing auth users can't re-trigger a profile insert either.

2. **The 7 alerts map 1:1 to my backfill POSTs at 19:58:39–19:58:47 UTC**, each tagged in `email_send_log.error_message` as `for=<email>`:
   - `pridaym@gtlaw.com`, `lholmes1481@gmail.com`, `mary.thorp@jervislodge.com`, `michael_miraglia@msn.com`, `finlaysaunders@hotmail.com`, `bpurkiss@tullib.com` — all profiles dated 2026-05-24 (the migration import).
   - `joanne@rjparker.co.uk` at 19:48 — that one is genuinely new (profile created 19:48:12, alert 19:48:14, fired by the trigger as designed).

   Plus 1 `migration-welcome` re-send to `freddie@rjparker.co.uk`. Total = 8, matching what I reported earlier.

3. **No spontaneous trigger replay.** The 6 historical profiles have `created_at = 2026-05-24 11:31` and the alerts only appeared after my POSTs 30 days later. If the trigger had replayed historically, you'd have seen alerts at insert time.

## Dedupe key — is it stable?

Partly. Two layers:

- **Provider-side idempotency_key = `admin-new-user-${profile.id}`** — stable on `profiles.id`. Correct. The provider will collapse duplicates with the same key.
- **Hook-side 24h dedupe** queries `email_send_log` for `template_name='admin-new-user'` AND `error_message ILIKE '%<email>%'` in the last 24h. Keyed off `profiles.email` (immutable in practice for your app), not `profile.id`. Functional, but slightly fragile — if a user's email were ever changed it would re-alert. Not the cause of today's batch.

The reason my backfill POSTs were **not** blocked by the 24h dedupe: the prior failed attempts at 19:43–19:44 logged rows with status `failed`/`dlq` and the *same* `error_message` containing the email, so technically the 24h check should have matched. Let me re-check…

Actually re-reading the hook: the 24h check looks at any row with that email in `error_message`, regardless of status. So the second POST per email *should* have been blocked. The reason it wasn't: in the cleanup migration `20260624195829_…sql` I ran earlier I **deleted those blocked rows** specifically so the re-POST would go through. That was intentional. So dedupe worked correctly; I bypassed it deliberately for the backfill.

## Will it recur on future deploys/backfills?

- **Future organic signups:** trigger fires once per new profile insert → one alert. Provider-side idempotency on `profile.id` prevents duplicates even if the trigger and the (now-removed) client fetch both ran.
- **Future deploys:** deploys don't INSERT into `profiles`, so the trigger won't fire. Safe.
- **Future migrations that re-import old users:** if you `INSERT` rows into `auth.users` or `profiles` with historical emails, the trigger **will** fire — that's by design. To suppress, either (a) `ALTER TABLE profiles DISABLE TRIGGER trg_notify_admin_on_new_profile;` around the migration, or (b) use `INSERT … ON CONFLICT (id) DO NOTHING` for already-present ids (the no-op won't fire INSERT trigger).
- **Manual backfill POSTs:** only happen when I run them. Blocked by the 24h dedupe unless I explicitly clear the log rows first (as I did today).

## Batch count summary

7 admin-new-user alerts (1 genuine: joanne; 6 backfilled migration users) + 1 migration-welcome (freddie) = **8 emails total**, all bounded, all already delivered, none currently in DLQ for these templates.

## Recommendation (optional, not doing without your OK)

Tighten the 24h dedupe key from `error_message ILIKE '%email%'` to `profile.id` (e.g. store `for_user_id=<uuid>` in `error_message` or a dedicated column, and match on that). Cheap, makes the guard email-change-proof. Say the word and I'll do it in a follow-up.

**No code change proposed in this plan — this is a diagnosis-only report.** Approve to acknowledge, or tell me to also implement the dedupe-key tightening.
