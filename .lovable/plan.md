Apply all the picks-confirmation revisions in one pass + fix the public-URL regression.

## 1. New shared helper: stable public site origin

Create `src/lib/email/site-origin.ts`:

```ts
export function getPublicSiteOrigin(): string {
  const fromEnv = (process.env.PUBLIC_SITE_URL ?? '').trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return 'https://www.major7s.com'
}
```

Used for any URL embedded in a user-facing email. Never derived from the inbound request. (The existing `resolveOrigin()` in `picks-confirmation.functions.ts` stays — but only for the internal server-to-server `fetch` to `/lovable/email/transactional/send`.)

## 2. `src/lib/email/picks-confirmation.functions.ts` — templateData build

Add three pure helpers at the top of the file:

```ts
const SHORT_NAME_MAP: Record<string, string> = {
  'Masters Tournament': 'Masters',
  'PGA Championship': 'PGA',
  'U.S. Open': 'US Open',
  'The Open Championship': 'The Open',
}
function shortTournamentName(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  return SHORT_NAME_MAP[n] ?? n
}

// "14 - 17 May" (same month) or "30 June - 3 July" (cross-month). No year.
function fmtDateRange(startIso?: string | null, endIso?: string | null): string { ... }

// "13 May @ 22:00 BST" — Europe/London; TZ label derived via Intl 'short'.
function fmtDeadlineLondon(iso?: string | null): string { ... }

// "15 Jul 2026 @ 14:32 BST" — Europe/London; same TZ derivation.
function fmtLastUpdatedLondon(iso?: string | null): string { ... }
```

TZ label: use `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' }).formatToParts(d)` and read the `timeZoneName` part (yields `GMT` / `BST`). No hardcoded mapping.

In `buildPicksConfirmationPayload`:

- Compute `shortName = shortTournamentName(tournament.name)` and `year = startDate.slice(0,4)`.
- Compute `dateRange = fmtDateRange(start_date, end_date)`.
- Compute `deadline = fmtDeadlineLondon(submission_deadline)`.
- Compute `lastUpdated = fmtLastUpdatedLondon(<max picks.last_edited_at>)` — already computed as `maxEdited`/`maxEditedIso`; reuse.
- `tournamentUrl = `${getPublicSiteOrigin()}/tournament/${tournament.id}`` (no longer uses `resolveOrigin()`).

New `templateData` shape passed to the template:

```ts
{
  firstName,
  shortName,           // e.g. "PGA"
  year,                // "2026"
  location,            // tournaments.location
  dateRange,           // "14 - 17 May"
  deadline,            // "13 May @ 22:00 BST"
  lastUpdated,         // "15 Jul 2026 @ 14:32 BST"
  teamNickname,
  picks,               // [{bucket, golfer}, …]
  tournamentUrl,       // https://www.major7s.com/tournament/<id>
  tweakCount,
}
```

Subject builder:

```ts
subject: (d) => `Picks confirmed - ${d?.shortName ?? 'Major7s'} ${d?.year ?? ''}`.trim()
```

Idempotency key: unchanged — `picks-confirmation-${teamId}-${tournamentId}-${maxEditedIso}`.

`resolveOrigin()`: keep as-is (request-derived origin + http/https heuristic). Used **only** by `postSend()` to hit `/lovable/email/transactional/send` on the same host.

## 3. `src/lib/email-templates/picks-confirmation.tsx`

Props rewritten to the new templateData shape (`shortName`, `dateRange`, `lastUpdated`, etc.). Layout:

```
+--------------------------------------------------+
| FOREST HEADER                                    |
|   PICKS CONFIRMED                  (white, upper)|
|   {shortName} {year}               (gold, bold)  |
|   {location}                       (muted white) |
|   {dateRange}                      (muted white) |
+--------------------------------------------------+
| BODY (white)                                     |
|   Hi {firstName},                                |
|   Picks submitted. You're locked in!  (forest)   |
|                                                  |
|   [picks table — B1..B7]                         |
|                                                  |
|   Last updated: {lastUpdated}        (muted)     |
|   Tweak count: {tweakCount}          (muted)     |
|                                                  |
|             [ VIEW TOURNAMENT ]      (gold btn)  |
|                                                  |
|   Unlimited edits allowed until {deadline}.      |
|     ^ left-aligned, normal body text             |
|   Good luck.                                     |
|                                                  |
|   ─────────────────────────────                  |
|   www.major7s.com  (single link to https://www.major7s.com, centered) |
+--------------------------------------------------+
```

Style tokens:
- Outer `<Body>` bg `#ffffff`.
- Header bg `#103D2E` (FOREST). Inside it: title `#ffffff` uppercase; `{shortName} {year}` `#C9A227` (GOLD) bold; location + dateRange `rgba(255,255,255,0.75)`.
- Button bg `#C9A227`, label color `#103D2E`, uppercase.
- Footer link color FOREST, underlined.

Hard rule: every dash in body, header, and subject is a plain ASCII hyphen `-`. No `–` / `—`.

`previewData` updated to match new shape (e.g. shortName `"PGA"`, dateRange `"14 - 17 May"`, deadline `"13 May @ 22:00 BST"`, lastUpdated `"15 Jul 2026 @ 14:32 BST"`).

## 4. Migration-welcome live origin (server-side override)

`src/lib/admin-users.functions.ts` `sendWelcomeEmails` currently trusts the caller-supplied `redirectTo`; the admin UI passes `${window.location.origin}/welcome`, which becomes the preview origin when an admin triggers it from the editor. Fix:

- Ignore `data.redirectTo` for the actual link. Build it server-side:
  `const redirectTo = `${getPublicSiteOrigin()}/welcome`` and pass that into `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })`.
- Keep accepting `redirectTo` in the input validator for backwards compat, but the value is no longer used.

`migration-welcome.tsx` itself: no changes (it already renders whatever URL it receives).

## 5. Sanity sweep

- Grep `picks-confirmation.tsx` + `migration-welcome.tsx` for `–` / `—` and replace with `-`.
- Confirm the registry still exports `picks-confirmation` (unchanged).
- `previewData` keys match new prop names so the dashboard preview renders.

## Verification (build mode)

1. Re-run `sendPicksConfirmationTest` via Playwright with the same args.
2. Confirm `templateData.tournamentUrl === 'https://www.major7s.com/tournament/08022118-1ee9-42b9-ae0e-6f2e203e6489'`.
3. Confirm `templateData.shortName === 'PGA'`, `dateRange === '14 - 17 May'`, `deadline` ends in `BST` (May is BST), `lastUpdated` ends in `BST`/`GMT` correctly.
4. Report back: full `templateData`, `idempotencyKey`, `sendStatus`.
