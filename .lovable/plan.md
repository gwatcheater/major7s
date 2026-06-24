# Email Handover Document — Plan

Goal: produce a single Markdown file at `docs/email-handover.md` documenting every email this app can send, then paste the full file contents back in chat. No code changes.

## Discovery (read-only)

Read in parallel and ground every claim in source:

- Templates: `src/lib/email-templates/{signup,recovery,invite,magic-link,email-change,reauthentication,welcome,migration-welcome,picks-confirmation,pick-reminder,admin-new-user}.tsx`, plus `registry.ts`.
- Auth send path: `src/routes/lovable/email/auth/webhook.ts` (subjects map, template selection, generateLink usage, redirectTo).
- App email send path: `src/routes/lovable/email/transactional/send.ts` (auth, suppression check, template render, enqueue, unsubscribe footer).
- Queue: `src/routes/lovable/email/queue/process.ts` (rate limit / batch size / TTL pulled from `email_send_state`).
- Triggers:
  - `src/lib/admin-users.functions.ts` — `sendWelcomeEmails`, any admin-new-user notifier, `previewWelcomeEmails`.
  - `src/lib/email/picks-confirmation.functions.ts` — picks-confirmation send.
  - `src/routes/api/public/hooks/new-user-signup.ts` — admin-new-user trigger.
  - `src/routes/api/public/hooks/pick-reminder.ts` — pick reminder cron trigger.
  - Any UI callers (admin users tab, picks submit flow) via ripgrep on each server fn name.
- Domain + rate limit: `email_domain--check_email_domain_status` for active sender domain; `email_send_state` row via `supabase--read_query` for batch_size / send_delay_ms / TTLs.
- Cross-check unused: ripgrep each template registry key and each auth template name for callers.

## Document structure (written to `docs/email-handover.md`)

1. **Header**: active sending domain, rate limit (batch_size, send_delay_ms, derived emails/min, auth + transactional TTL), unsubscribe footer policy (auto-appended by `/lovable/email/transactional/send`; auth emails do not get one).
2. **Summary table 1 — All emails**: name | type (auth/app) | trigger (auto/admin/cron) | live | template path.
3. **Summary table 2 — Sender functions**: function | file | emails sent | send mechanism (Supabase auth webhook vs `/lovable/email/transactional/send` vs direct `supabase.auth.admin.generateLink` + render).
4. **Summary table 3 — Issues**: hardcoded values, unused templates, variable mismatches, missing triggers, welcome vs migration-welcome overlap, any template registered but never sent, any sender that bypasses the queue/suppression.
5. **Per-email sections** (one per email, 11 total) with the 7 fields the user asked for, including the **full template source pasted verbatim** inside fenced ```tsx blocks.

Order: auth first (signup, recovery, invite, magic-link, email-change, reauthentication), then app (welcome, migration-welcome, picks-confirmation, pick-reminder, admin-new-user).

## Deliverable

- Create `docs/email-handover.md` (new file, no other edits).
- Paste the full file contents back in chat in a single fenced ```markdown block.
- No code, schema, config, or template changes. Read-only.
