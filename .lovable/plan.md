# Fix "Hi Rob" in migration-welcome emails

## Where "Rob" lives today

I grepped the whole repo. The literal string `Rob` only appears in template **previewData** blocks (the in-app preview tool reads these; the live send path does not):

- `src/lib/email-templates/migration-welcome.tsx` line 78 — `previewData: { firstName: 'Rob', ... }`
- `src/lib/email-templates/welcome.tsx`, `picks-confirmation.tsx`, `pick-reminder.tsx` — same pattern
- `src/lib/email-templates/admin-new-user.tsx` — `referralName: 'Rob Parker'`

The live `sendWelcomeEmails` in `src/lib/admin-users.functions.ts` already:
1. Selects `id, email, first_name` from `profiles` for the requested `userIds`.
2. For each user, calls `React.createElement(migrationWelcomeTemplate.component, { firstName: profile?.first_name ?? undefined, setPasswordUrl })`.
3. Renders to HTML/text per user and enqueues a unique payload per user.

The template greeting already reads:
```ts
const greeting = firstName && firstName.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
```

So on paper the per-recipient `first_name` is already wired through and `Rob` is only a preview-time default. A spot-check of the DB confirms `profiles.first_name` is populated with varied names (Will, Chris, Dan, Jamie, …), so the data is fine too.

That means the "every email says Hi Rob" report does not match the current code. Before changing anything, I want to confirm what is actually being rendered for real users, then harden the path so this cannot regress.

## Plan

### 1. Add a read-only diagnostic server fn (admin-only)
New `previewWelcomeEmails` in `src/lib/admin-users.functions.ts`:
- Input: `{ userIds: string[] }` (max ~5).
- Loads each `profiles` row, builds the same `migrationWelcomeTemplate` element with `firstName: profile.first_name`, renders, and returns `{ id, email, first_name, greetingLine, htmlSnippet }` per user. Does not enqueue or send.
- Lets us prove, for two specific provisioned users, that the greeting line is correct end-to-end.

### 2. Harden `sendWelcomeEmails` against accidental fallbacks
In `src/lib/admin-users.functions.ts` keep the same `{ userIds, redirectTo }` signature, but:
- Normalize `firstName` once: `const firstName = profile?.first_name?.trim() || undefined`.
- Log (server-side only) `{ id, hasFirstName: Boolean(firstName) }` per recipient so future regressions are visible in function logs without leaking PII.
- Pass `firstName` (not `profile?.first_name ?? undefined`) into the template element so blank strings can never sneak through as a truthy value.

### 3. Reaffirm template greeting + drop "Rob" from preview defaults
In `src/lib/email-templates/migration-welcome.tsx`:
- Keep the existing greeting logic (`firstName?.trim() ? 'Hi {name},' : 'Hi there,'`) — it is already correct.
- Change `previewData.firstName` from `'Rob'` to `'Jamie'` (or drop it entirely) so the in-app preview can never be confused with "every send says Rob".
- No other template changes; layout, colors, button, fallback link, footer all stay.

### 4. Verify with two real recipients
After deploy:
1. Call `previewWelcomeEmails` for two provisioned users with different first names; confirm each rendered greeting matches their `profiles.first_name`.
2. Trigger `sendWelcomeEmails` for those same two users from the admin Users tab.
3. Check `email_send_log` for two distinct `message_id`s, two distinct recipients, both `status='sent'`.
4. Confirm in the actual inboxes that each greeting matches the recipient.

If step 1 already shows the correct per-user greeting (which the current code suggests it will), the report was likely based on a single self-test or on the preview tool — the diagnostic fn + previewData change will make that impossible to misread again. If step 1 shows "Rob" for everyone, the diagnostic output tells us exactly which layer is wrong (profile fetch, template element props, or render) and I will fix that specific layer.

## Files touched
- `src/lib/admin-users.functions.ts` — add `previewWelcomeEmails`; tighten `firstName` handling in `sendWelcomeEmails`.
- `src/lib/email-templates/migration-welcome.tsx` — change `previewData.firstName` away from `Rob`.

No DB migrations. No changes to other auth or transactional templates. No changes to the `/welcome` page or the queue processor.
