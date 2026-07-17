## Add B1–B7 pick columns to Major7s leaderboard rows

Extend each team row in the Major7s leaderboard table (`src/routes/_authenticated/tournament.$id.leaderboard.tsx`) with 7 additional columns, one per bucket, showing the golfer's name and their current Major7s points/position in parentheses.

### What each cell shows

Data is already computed per team in `team.picks: RoundPickScore[]` (bucket, golfer_name, points, status_label, counted).

Format per cell — bucket picks sorted by `bucket` 1→7:
- Normal: `Rahm (12)` — where `12` is `points` (= current Major7s position after SCR).
- CUT / WD: `Lowry (CUT · 100)` / `(WD · 100)`.
- Not-counted picks (worst 2 of 7): dimmed / struck-through so the "best 5" are visually clear.

### Table changes

1. `MajorCols` — append 7 `<col style={{ width: "88px" }} />` entries (only in the main table, not in the "my team" panel).
2. Header row — add `B1 … B7` `<th>`s.
3. `RoundExpandableTeamRow` (visible expanded row body already exists) — add 7 `<td>`s rendering the picks. Keep the existing expand affordance for the full breakdown.
4. Increase table container to allow horizontal scroll on narrow screens: wrap the `<table>` in `<div className="overflow-x-auto">` and drop `tableLayout: fixed` OR keep fixed and rely on horizontal scroll. Mobile (440px) will scroll horizontally — a 7-team-column view can't fit natively.
5. Update `colSpan` on the "No teams" empty row from `showDelta ? 6 : 5` to include the 7 new columns.

### Out of scope

- No DB/schema changes; all data already in memory.
- Panel for "my team" (`RoundActiveTeamPanel`) — leave unchanged unless you want it too.
- Tournament view — unchanged.

### Open question

At 440px viewport, 7 extra columns will require horizontal scrolling. Acceptable, or do you want a compact variant (e.g. surname only + points, ~56px per column)?
