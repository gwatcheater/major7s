Generate an end-of-Round-3 Major7s leaderboard as a Markdown table only (no app code changes).

Steps:
1. Query `picks` + `tournament_leaderboard` for The Open Championship (`e101de0e...`) to get current R1/R2/R3 positions and cut status.
2. Build cumulative position maps per round (R1, R2, R3), and per-team Major7s scores per round (best 5 of 7, CUT/WD = 100).
3. Render one Markdown table with columns: Team Name | Golfers Picked (B1–B7 as `Full Name (R1 | R2 | R3)`, CUT shown as `CUT | CUT`) | Players Through Cut | Round 1 Score | Round 2 Score | Round 3 Score.
4. Save to `/mnt/documents/open-major7s-r3-end-leaderboard.md` and return the raw table.