---
name: testing-leaderboard
description: Test the Major7s tournament leaderboard page end-to-end. Use when verifying round view scoring, pick breakdowns, BOTR/ThruCut, or round toggle UI changes.
---

# Testing the Major7s Leaderboard

## Overview

The leaderboard page (`/tournament/$id/leaderboard`) has two view modes (Major7s and Tournament) and four round views (R1-R4). Each round computes team scores on-the-fly from the `tournament_leaderboard` table.

## Prerequisites

### Devin Secrets Needed
- `MAJOR7S_ADMIN_PASSWORD` — password for `rob@rjparker.co.uk` admin account

### Dev Server Setup
- Use Node v20 (v22 may cause ESM/CJS cycle errors with Vite)
- Run `npm run dev` from the repo root; dev server starts on `localhost:8080`
- The project uses Lovable Cloud with an isolated Supabase instance — no service role key or direct DB access available. All testing must go through the authenticated UI.

### Authentication
- Login via the UI at `/auth` with email `rob@rjparker.co.uk` and the password from the secret
- If automating login, use Playwright CDP at `http://localhost:29229` to fill the form and submit
- RLS is enforced — unauthenticated/anon queries to `tournament_leaderboard` will return empty results
- After login, the session persists in the browser; just navigate to the leaderboard URL

### Test URL
```
http://localhost:8080/tournament/{tournament_id}/leaderboard
```
The current active tournament (US Open 2026) has ID `4b70ec33-6bdb-4cad-ba36-40d777960757`.

## Key Behaviors to Test

### Round Toggle Labels
- Major7s view: four buttons labeled R1, R2, R3, R4
- Tournament view: same four buttons
- Historically the R4 button was labeled "Current" or "Final" — verify it says "R4"

### Per-Round Column Count (Pick Breakdown)
When you expand a team row, the pick breakdown table should show:
- R1: 1 column (R1)
- R2: 2 columns (R1, R2)
- R3: 3 columns (R1, R2, R3)
- R4: 4 columns (R1, R2, R3, R4)

This is the most important regression to check — the old code showed only 2 columns max (prev + current).

### BOTR and Thru Cut Visibility
- R1: No BOTR toggle, no Thru Cut column, no delta column
- R2: No BOTR toggle, no Thru Cut column, has delta column
- R3: BOTR toggle visible, Thru Cut column visible, delta column visible
- R4: BOTR toggle visible, Thru Cut column visible, delta column visible

### Non-Finisher Handling
- Golfers who missed the cut (CUT) or withdrew (WD) should show their R1 position and dashes ("—") for subsequent rounds
- They appear at the bottom of the pick breakdown in muted/lighter style
- They receive a 100-point penalty instead of their position

### Team Scoring
- R4 scores are computed on-the-fly (same path as R1-R3), NOT read from `tournament_scores`
- Best 5 of 7 picks count toward the team score
- Teams are ranked using Standard Competition Ranking (ties get "T" prefix)

## Testing Tips

- Use the DOM/HTML output from the computer tool to verify column headers programmatically (look for `<th>R1</th>`, `<th>R2</th>`, etc.)
- Click team rows to expand/collapse pick breakdowns — the expand chevron is on the right side of each row
- The "Your Team" section at the top always shows the logged-in user's team with a highlighted background
- When switching rounds, the table re-renders with new data — wait for scores to load before asserting
- 107 teams is the expected count for this tournament

## Common Issues

- **Empty leaderboard / "No scoring data"**: Usually means the session is unauthenticated. Re-login via the UI.
- **Node v22 errors**: Downgrade to Node v20 (`nvm use 20`). The Vite dev server may fail with ESM/CJS cycle errors on v22.
- **Login failures**: The password may have changed. Check the `MAJOR7S_ADMIN_PASSWORD` secret and ask the user to update if invalid.
- **Slow initial load**: The first round view load might take a few seconds as it fetches all leaderboard data from Supabase. Subsequent round switches are faster since data is cached.
