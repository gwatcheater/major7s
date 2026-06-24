Rework only the picks-confirmation template + send function. Keep routing through `/lovable/email/transactional/send` (unsubscribe token still minted). Match `migration-welcome` brand styling. No other templates touched.

## 1. Template — `src/lib/email-templates/picks-confirmation.tsx`

Rewrite component to match spec exactly:

- White outer bg, forest `#103D2E` header bar, gold `#C9A227` button w/ dark text (mirror migration-welcome).
- New props: `firstName`, `tournamentName`, `year`, `location`, `startDate`, `endDate` (already DD/MM/YYYY strings), `deadline` (DD/MM/YYYY, HH:mm string), `teamNickname`, `picks: { bucket, golfer }[]`, `tournamentUrl`, `tweakCount`.
- Body order:
  1. `Hi {firstName},` (fallback `Hi there,`)
  2. Info block: bold `{name} {year}`, then `{location}`, then `{startDate} - {endDate}`, blank line, bold `Picks submitted. You're locked in!`, blank line.
  3. Picks table, 2 cols × 8 rows. Row 1 = team nickname spanning both cols (header style). Rows 2-8 = `B1`..`B7` / golfer name.
  4. `Unlimited edits allowed until {deadline}.`
  5. Keep existing `View Tournament` button + `tournamentUrl`.
  6. `Good luck.`
  7. `Tweak count: {tweakCount}`
- Footer: replace `Major7s · The majors picks league` with a single linked line: text `www.major7s.com` → `https://www.major7s.com`.
- Subject (dynamic): `Picks confirmed - {tournamentName} {year}`. Short hyphens only — scan/replace any en/em dashes.
- `previewData` updated to new shape.

## 2. Send function — `src/lib/email/picks-confirmation.functions.ts`

Drop the `isUpdate` input (spec subject is always "Picks confirmed"). Keep `tournamentId`, `teamId` inputs; ignore client-passed `tweakCount` (derive from DB).

Data fetch changes:
- `tournaments`: select `name, location, start_date, end_date, submission_deadline`.
- `picks`: select `bucket, golfer_id, last_edited_at, tweak_count` for `(tournamentId, teamId)`, order by `bucket`.
- `golfers`: **fix existing bug** — select `id, golfer_name` (not `name`); map by `golfer_name`.
- `teams`: select `nickname` where `id = teamId` for team nickname.
- `profiles`: `first_name` only (no `nickname` fallback in greeting).

Formatting:
- Year = `start_date.slice(0,4)`.
- `startDate`/`endDate` → DD/MM/YYYY via manual format (avoid TZ shifts on date-only).
- `deadline` → `DD/MM/YYYY, HH:mm` in `Europe/London` (Intl with `timeZone: 'Europe/London'`, `hour12: false`).
- `tweakCount` = `Math.max(...picks.map(p => p.tweak_count ?? 0), 0)`.
- `tournamentUrl` = `${origin}/tournament/${tournament.id}` (unchanged).

Idempotency key: `picks-confirmation-${teamId}-${tournamentId}-${maxLastEditedAtIso}` where `maxLastEditedAtIso` = max `last_edited_at` across the 7 picks (ISO string). Replaces `Date.now()`.

`templateData` passes: `firstName, tournamentName, year, location, startDate, endDate, deadline, teamNickname, picks: [{bucket, golfer}], tournamentUrl, tweakCount`.

Optional `recipientOverride` input (admin-only): if present AND caller has admin role (`has_role` RPC check), send to that address instead of `profile.email`. Used by the test-send below to avoid a new endpoint.

## 3. Admin test-send — same file, new exported server fn

`sendPicksConfirmationTest` in `src/lib/email/picks-confirmation.functions.ts`:

- `createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])`.
- Input: `{ tournamentId: string; teamId?: string; teamNickname?: string; recipientEmail: string }`.
- Verify caller is admin via `supabase.rpc('has_role', { _user_id: userId, _role: 'admin' })`; else throw.
- Resolve `teamId`: if not given, look up by `teamNickname` (case-insensitive). Error if ambiguous/missing.
- Call the same internal builder used by `sendPicksConfirmation` (factor the data-fetch + send into a shared helper inside the file) with `recipientEmail` override. Pulls **real** picks/tournament/team data — no preview data.
- Returns `{ ok, recipientEmail, idempotencyKey, templateData }` so I can paste it back to you for verification.

How to call (admin only, from browser console while signed in as admin):
```ts
import { sendPicksConfirmationTest } from '@/lib/email/picks-confirmation.functions'
// e.g. via useServerFn in a temporary dev affordance, or call from any admin page handler
await sendPicksConfirmationTest({ data: { tournamentId: '<uuid>', teamNickname: '<name>', recipientEmail: 'you@x.com' } })
```
I'll add a tiny admin-only button on the existing tournament page to invoke it — or, if you prefer no UI, just expose the server fn and you can call it from the existing admin debug panel. Default: server fn only, no new UI; tell me if you want the button.

## 4. Caller site

`src/routes/_authenticated/tournament.$id.lineup.tsx` already calls `sendPicksConfirmation({ data: { tournamentId, teamId, isUpdate, tweakCount } })`. Update call to drop `isUpdate`/`tweakCount` (now derived server-side). No other behavior change.

## Report back after build

Will paste back: the full new template, the `templateData` object literal built in the send function, and the `sendPicksConfirmationTest` signature + sample invocation.

## Files touched
- `src/lib/email-templates/picks-confirmation.tsx` (rewrite)
- `src/lib/email/picks-confirmation.functions.ts` (rewrite + new test fn + bugfix `golfer_name`)
- `src/routes/_authenticated/tournament.$id.lineup.tsx` (trim call args)

Question before I build: do you want a temporary admin-only **button** on the tournament page to trigger the test send, or is the server fn alone enough (you'll call it however you like)?