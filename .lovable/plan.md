Extract current Round 3 live Major7s leaderboard for "The Open Championship" and output a Markdown table only (no code changes).

## Steps

1. Query `picks` joined to `golfers` and `tournament_leaderboard` for tournament id `e101de0e...` ("The Open Championship"), pulling each team's 7 bucketed picks with full golfer names and current R3 position/points.
2. In a Python script, for each team:
   - Compute Major7s score = sum of best 5 of 7 pick points (CUT/WD = 100).
   - Count Players Through Cut = golfers not CUT/WD (max 7).
   - Build "Full Name (R3 Pos)" per bucket, or "Full Name (CUT)" if missed cut.
3. Write output to `/mnt/documents/open-major7s-r3-live.md` with columns: Team Name | B1..B7 | Players Through Cut | Current Score.
4. Return the raw Markdown table.

## Technical

- Source: `tournament_leaderboard` (current R3 position + major7s points), `picks` (bucket 1-7), `golfers` (full name), `teams` (nickname).
- No app code changes.
