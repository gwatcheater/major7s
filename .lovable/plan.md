Use `/mnt/documents/open-major7s-r3-leaderboard-v2.md` as the immutable base — do not regenerate teams, rosters, names, or existing parenthetical positions.

Steps:
1. Read v2 line-by-line. Preserve team order, team names, bucket assignments, and existing `Full Name (R1 | R2)` strings byte-for-byte (including the `Højgaard` / distinct `Kim` spellings).
2. Build an R3 position map from `tournament_leaderboard` for The Open (`e101de0e...`) round 3 (fall back to current position for cut players → `CUT`). Match golfers to v2 rows using the stored `espn_display_name` used yesterday.
3. For each golfer cell, regex-append ` | <R3Pos>` inside the existing parentheses. If the current text already ends with `| CUT)`, append ` | CUT` (becomes `... | CUT | CUT)`).
4. Column handling — v2's second score column is labelled `R3 Score` but held the live/interim value. Per the request:
   - Rename that existing column header to `R2 Score` and keep its numbers unchanged.
   - Append a new final column `R3 Score` computed as end-of-R3 Major7s totals (best 5 of 7, CUT/WD = 100), using the same scoring logic used yesterday.
5. Leave `Pos`, `Team`, `Thru Cut`, and `R1 Score` columns unchanged.
6. Write result to `/mnt/documents/open-major7s-r3-end-leaderboard-v2.md` and emit only the raw Markdown table (escaped `\|` inside parentheses) in the reply.

Please confirm point 4 — v2 does not contain a true "R2 Score" column; its second score was the live R3 snapshot. I'll relabel it `R2 Score` and add a fresh `R3 Score` unless you'd rather I recompute a true end-of-R2 score instead.