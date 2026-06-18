# Restore "Live Leaderboard" link and clarify email templates

## 1. External URL link on tournaments

Your read is correct. After commit `c9114e4`, the tournament hub renders the "Live Leaderboard" / official-site link only when `tournaments.external_url` is set. I verified the DB: `external_url` is `NULL` on every tournament row (Masters, PGA, U.S. Open, The Open — past and current), so the link is hidden everywhere.

Fix (data, not code): populate `external_url` on the rows that should show the link. Proposed values:

- All 4 active majors for 2026 (Masters, PGA, U.S. Open, The Open) → `https://www.major7s.co.uk/#/`
- Historical/past tournaments → leave `NULL` (link stays hidden), unless you want them populated too

I'll do this with a single `UPDATE` on `public.tournaments`. No code changes — the admin "External Link URL" field already lets you edit per-tournament going forward.

Open questions:
- Set the same URL on **all tournaments** (past + future), or just the **4 current/upcoming 2026 majors**?
- Use exactly `https://www.major7s.co.uk/#/`, or a different URL?

## 2. Custom email templates "missing"

The templates are still in the repo and registered — nothing was deleted:

- App emails (`src/lib/email-templates/registry.ts`): `welcome`, `picks-confirmation`, `pick-reminder`, `admin-new-user`
- Auth emails (wired in `src/routes/lovable/email/auth/webhook.ts`): `signup`, `invite`, `magiclink`, `recovery`, `email_change`, `reauthentication`

If the Cloud → Emails dashboard is showing them as missing/blank, that's a dashboard view issue, not a code issue — typically resolved by republishing so the latest server routes/templates are live, or by hard-refreshing the dashboard. Before doing anything here I'd like to confirm what you're actually seeing.

Open question:
- In Cloud → Emails, are the template **entries gone from the list**, or are they listed but **previews are blank / show default content**? A screenshot or the exact wording helps.

## Plan once you confirm

1. Run a single data update setting `external_url` on the agreed tournament rows.
2. Verify the link reappears on the tournament hub.
3. For emails: based on your answer, either republish to refresh the dashboard, or investigate the specific template that looks wrong.

No code edits planned in step 1 — the feature is already implemented correctly; it just needs data.
