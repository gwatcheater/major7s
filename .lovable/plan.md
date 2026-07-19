
# Leaderboard architecture report — documentation only

Produce a single Markdown file at `docs/leaderboard-architecture.md` documenting the CURRENT leaderboard implementation. No code changes, no schema changes, no new dependencies. Corrects the user's premise where it differs from the codebase (this is TanStack Start, not Remix; there is no Prisma; the loader pattern is client-side TanStack Query, not a Remix `loader`).

## Sources of truth to cite

- Route file: `src/routes/_authenticated/tournament.$id.leaderboard.tsx` (1317 lines) — dual-view UI, round toggle, on-the-fly Major7s scoring, expandable pick breakdown, medals.
- ESPN ingest + settled scoring: `src/lib/espn-leaderboard.functions.ts` — server function that upserts `tournament_leaderboard` and writes `tournament_scores` / `tournament_score_picks`.
- Schema reference: `docs/data-dictionary.md` — canonical column list for `tournaments`, `golfers`, `picks`, `teams`, `tournament_leaderboard`, `tournament_scores`, `tournament_score_picks`, `user_roles`.
- Client: `src/integrations/supabase/client.ts` (browser reads via RLS).

## Report sections

1. **Overview & architecture**
   - Stack: TanStack Start + TanStack Router + TanStack Query, Supabase Postgres with RLS, browser-side reads via the anon client.
   - Request lifecycle: URL `/tournament/$id/leaderboard` → route component mounts → three parallel Supabase queries (`tournaments` header, `tournament_leaderboard` rows, my `picks`) → in-memory grouping / round-position derivation → Major7s on-the-fly scoring (picks + teams queries) → render. Include a small ASCII diagram.
   - Data write path (separate lifecycle): admin triggers ESPN import server fn → `tournament_leaderboard` upsert → `calculateMajor7sScores` writes `tournament_scores` + `tournament_score_picks` (settled snapshot, distinct from the on-the-fly per-round view rendered in the UI).

2. **Database schema (actual, Postgres)**
   - Reproduce the real tables with columns, types, PKs, FKs, unique constraints, and indexes actually implied by the uniques/FKs. Explicitly note: no Prisma in this project; DDL lives in Supabase migrations.
   - Tables covered: `tournaments`, `golfers`, `picks`, `teams`, `tournament_leaderboard` (including `position_r1..r4`, `status_type`, `status_short_detail`), `tournament_scores`, `tournament_score_picks`. Cross-link to `docs/data-dictionary.md` rather than duplicating every column comment.
   - Correct the prompt's mental model: no separate `Round_Scores` table — round strokes and per-round positions are columns on `tournament_leaderboard`; no `Players` master table — golfer identity is per-tournament in `golfers`; "Major7s entries" = `picks` (bucket 1–7) joined via `teams`.

3. **Data population (client queries, not a Remix loader)**
   - Document each `useQuery` in the route: query key, select list, filters, page-size handling (picks pagination in 1000-row pages to defeat PostgREST's default ceiling — Masters 2026 example).
   - Document the ESPN ingest server function pipeline at a high level (name matching via `normalizeName`, `picks_helper`, upsert on `(tournament_id, espn_player_id)`, settled score calc).
   - Edge cases: CUT vs WD detection (both land on `STATUS_CUT`; WD disambiguated via `status_short_detail`), DQ/DNS fall through the non-finisher branch and score `NON_FINISHER_POINTS = 100`, missing `position_rN` → carry-forward for still-active players mid-round.

4. **Dual-view logic**
   - State model: `view: "tournament" | "major7s"` and shared `round: "r1"|"r2"|"r3"|"r4"` in `LeaderboardView`.
   - Tournament view: `TournamentTable` + `TourneyRow` — describe grouping (active vs cut for R4, per-round filter for R1–R3), tie detection (`is_tie` for R4, derived tie set for R1–R3), Δ movement rendering, "mine" highlight via `myPickGolferIds`.
   - Major7s view: `MajorSevensTable` + `useMajor7sRoundScores` — best-5-of-7 with Standard Competition Ranking, per-round position map (`buildRoundPositionMap`), in-progress round handling via `getInProgressRound`, ALL vs BOTR filter (R3/R4 only), "Your Team" pinned panel, expandable pick breakdown, gold/silver/bronze medal overlay when R4 is complete.

5. **Round-by-round filtering (R1–R4)**
   - `RoundToggle`: derives `maxRound` from which `position_rN` columns are populated, plus the post-R2 cut heuristic (cutCount > 5 unlocks R3 view). Future rounds are hidden entirely, not just disabled — document this and why.
   - Auto-snap effect when the current selection exceeds `maxRound`.
   - Round-aware column visibility inside `TourneyCols` (`showR1..R4`, `showToPar`, `showDelta`).

6. **UI components**
   - Inventory: `LeaderboardView`, `RoundToggle`, `TournamentTable`, `TourneyRow`, `TourneyCols`, `MajorCols`, `MajorSevensTable`, `RoundActiveTeamPanel`, `RoundExpandableTeamRow`, `RoundPickBreakdown`, `Major7sDeltaCell`, `PositionMedal`.
   - Visual affordances actually present: ↑/↓ Δ arrows with colour, `bg-amber-50` "mine" row + amber "Your Team" panel, `Missed Cut / Withdrew` divider, radial-gradient gold/silver/bronze medals (R4 complete only), sticky Major7s header, animated expand chevron.
   - Cut-line indicator: currently a section divider in the Tournament view — call this out as the closest existing analogue to the prompt's "cut-line indicator"; do not invent new UI.

7. **Gaps & known constraints (short, factual)**
   - No SSR loader; blank initial paint until Query resolves. Rationale: route sits under `_authenticated`, which redirects unauth users.
   - ESPN ingest is admin-triggered, not scheduled — freshness depends on admin action.
   - Per-round positions depend on ESPN `linescores[].currentPosition`; older tournaments without this data hide the round toggle entirely.

## Out of scope (explicit non-goals)

- No code changes to the route, server functions, schema, or styles.
- No Prisma schema (project uses Supabase migrations; document what exists).
- No new components, no "up/down arrow" additions — the Δ column already renders them.
- No rewrite into a Remix `loader` shape.

## Deliverable

Single file: `docs/leaderboard-architecture.md`. Target length ~600–900 lines with an ASCII diagram, real column lists, and code excerpts pulled verbatim from the two source files with line references.
