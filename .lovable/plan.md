## Diagnosis

The "Live Leaderboard" link already exists in the tournament hub (`src/routes/_authenticated/tournament.$id.tsx`, lines 316–336). It renders whenever `tournaments.external_url` is set and status ≠ `completed`, opening the URL in a new tab with an `ExternalLink` icon and a pulsing "Live" pill — exactly as it did on the previous card.

The reason it's missing on the current live tournament is data, not code:

- Current live tournament: **The Open Championship** — `external_url = NULL`
- Previous tournament that showed the link: **U.S. Open** — `external_url = https://www.major7s.co.uk/`

So nothing is broken in the UI; the field just hasn't been filled in for The Open.

## Plan

1. Update the row for The Open Championship in `public.tournaments`, setting `external_url = 'https://www.major7s.co.uk/'` (same value that worked on the U.S. Open card).
2. No code changes. The existing block in `tournament.$id.tsx` will immediately render the "Live Leaderboard" row above the "Leaderboard (end of round)" row, opening in a new tab.

## Question before I run it

Do you want the link to point to `https://www.major7s.co.uk/` (the same URL the U.S. Open used), or to a different Open Championship leaderboard URL (e.g. the R&A / DP World Tour live leaderboard)? If the latter, paste the URL and I'll use that instead.

Also — going forward, this field is editable per-tournament from the Admin panel's tournament edit form (the "External link URL" field), so you can set it there for future events without a DB write.
