## Goal
Deliver the current Major7s leaderboard for The Open Championship as a **Markdown table only**, with 7 extra columns showing each team's B1–B7 golfer picks and their current Major7s points. No code changes.

## Steps
1. Revert the code edits made last turn to `src/routes/_authenticated/tournament.$id.leaderboard.tsx` (restore original `MajorCols`, `RoundExpandableTeamRow`, and main table markup — no B1–B7 columns in the UI).
2. Query the DB for the active tournament (`e101de0e-...`, The Open):
   - All teams + nicknames
   - Each team's 7 picks (bucket, golfer_name)
   - Current Major7s points per golfer (from `tournament_leaderboard` / same logic used by `useMajor7sRoundScores`: real finish → points, CUT/WD → 100)
3. Recompute each team's total using best-5-of-7 (matching the live leaderboard) and rank with ties.
4. Output a single Markdown table:

   | Pos | Team | Total | B1 | B2 | B3 | B4 | B5 | B6 | B7 |

   Each pick cell: `Surname (pts)`. Non-counted picks (worst 2 of 7) marked with `~~strikethrough~~`. CUT/WD shown as `Surname (CUT·100)`.
5. Return the full table (all ~148 teams) in chat. No files written, no code deployed.

## Confirm before I run
- Round to use: **latest completed round** (R1 so far), same as the live leaderboard default? Or a specific round?
