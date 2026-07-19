# Leaderboard Architecture

Scope: the tournament leaderboard module rendered at
`/tournament/$id/leaderboard`. This document describes the **current**
implementation. No proposals, no future-state.

Two primary source files back everything below:

- `src/routes/_authenticated/tournament.$id.leaderboard.tsx` — route
  component, dual-view UI, round toggle, on-the-fly Major7s scoring,
  expandable pick breakdown, medals. (1317 lines.)
- `src/lib/espn-leaderboard.functions.ts` — server function that ingests
  ESPN data into `tournament_leaderboard` and writes settled
  `tournament_scores` / `tournament_score_picks`. (566 lines.)

Schema reference lives in [`docs/data-dictionary.md`](./data-dictionary.md);
this doc reproduces only what matters to the leaderboard.

> Framework note: this project is **TanStack Start** (React 19, Vite,
> file-based routing). It is not Remix. There is no `loader` export on the
> route, no `useLoaderData()`, and no Prisma — DDL lives in Supabase
> migrations, and reads happen in the browser through TanStack Query
> against Supabase (Postgres + RLS).

---

## 1. System overview

### 1.1 Runtime stack

| Concern         | Implementation                                                  |
| --------------- | --------------------------------------------------------------- |
| Routing         | TanStack Router file routes (`src/routes/_authenticated/…`)     |
| Data fetching   | TanStack Query (`@tanstack/react-query`) in the browser          |
| Auth gate       | `_authenticated` layout redirects unauth users before mount      |
| Database        | Supabase Postgres, RLS enabled on every user-facing table        |
| Client          | `@/integrations/supabase/client` (publishable/anon key, PKCE)    |
| Ingest          | `createServerFn` in `src/lib/espn-leaderboard.functions.ts`      |
| Ingest client   | `@/integrations/supabase/client.server` (service role, RLS bypass) |

### 1.2 Read path (browser → screen)

```text
GET /tournament/$id/leaderboard
        │
        ▼
_authenticated layout gate  ──► redirect /login when no session
        │
        ▼
LeaderboardView mounts (client-side, no SSR loader)
        │
        ├─ useQuery("tournament-leaderboard-header", id)
        │     SELECT id, name, location, status FROM tournaments WHERE id = $id
        │
        ├─ useQuery("tournament-leaderboard", id)
        │     SELECT id, golfer_id, espn_display_name, country,
        │            position_display, position_numeric, is_tie,
        │            status_type, status_short_detail,
        │            total_strokes, score_to_par,
        │            round_1..round_4, position_r1..position_r4
        │     FROM tournament_leaderboard WHERE tournament_id = $id
        │
        └─ useQuery("my-picks-golfer-ids", activeTeam.id, id)
              SELECT golfer_id FROM picks
              WHERE team_id = $activeTeam AND tournament_id = $id
        │
        ▼
in-memory: derive maxRound, group active vs cut,
           build tie-position sets, sort per round
        │
        ▼
render dispatch on `view`
        │
        ├─ view === "tournament"  →  <TournamentTable />
        │
        └─ view === "major7s"     →  <MajorSevensTable />
                                        │
                                        ├─ useQuery("major7s-round-picks", id)
                                        │     paginated 1000-row scan of picks
                                        │
                                        ├─ useQuery("major7s-round-teams", id)
                                        │     tournament_scores JOIN teams
                                        │
                                        ▼
                            computeRoundScores() → best 5 of 7,
                            per-round position map, SCR ranking,
                            Δ vs previous round
```

### 1.3 Write path (admin → database)

The write path is **separate** from the read path. The UI never mutates
leaderboard data.

```text
Admin clicks "Import ESPN" on the tournament admin page
        │
        ▼
createServerFn in src/lib/espn-leaderboard.functions.ts
  · fetches ESPN scoreboard/leaderboard JSON
  · normalises names, matches against public.golfers via
    normalizeName() + picks_helper fallback
  · UPSERT tournament_leaderboard ON CONFLICT (tournament_id, espn_player_id)
  · calculateMajor7sScores(tournamentId, userId)
        · reads tournament_leaderboard rows for this tournament
        · joins to picks + golfers
        · best 5 of 7, NON_FINISHER_POINTS = 100
        · writes tournament_scores + tournament_score_picks
```

Two important consequences:

1. **The Major7s view in the UI does NOT read `tournament_scores`.** It
   recomputes scores on the fly per round from `tournament_leaderboard`
   + `picks`. `tournament_scores` is the *settled* snapshot used by
   Hall of Fame, archive, blog reports, and history pages.
2. Freshness of both the Tournament view and the on-the-fly Major7s
   view depends entirely on an admin having re-imported ESPN data.
   Nothing is scheduled.

---

## 2. Database schema

Full column-level docs are in [`docs/data-dictionary.md`](./data-dictionary.md).
The excerpt below is the subset the leaderboard actually touches, plus
the constraints and indexes that matter for it.

> This project has no Prisma schema. Tables are created by SQL migrations
> under `supabase/migrations/` and consumed through the generated types at
> `src/integrations/supabase/types.ts`.

### 2.1 `tournaments`

Read columns: `id`, `name`, `location`, `status`.

Relevant constraints:

- PK `id`
- Referenced by every table below (CASCADE on delete except
  `blog_posts.tournament_id` which is SET NULL).

### 2.2 `golfers` (per-tournament field)

There is no cross-tournament "players" master table. Each tournament has
its own field row set, keyed by name.

- PK `id`
- FK `tournament_id` → `tournaments.id` ON DELETE CASCADE
- UNIQUE `(tournament_id, golfer_name)` — used by ingest to resolve
  ESPN names to internal golfer rows before writing picks-facing data
- Referenced by `picks.golfer_id`,
  `tournament_leaderboard.golfer_id` (SET NULL when unmatched),
  `tournament_score_picks.golfer_id` (SET NULL).

### 2.3 `tournament_leaderboard` (the primary read table)

One row per (tournament, ESPN player). This is where every column
consumed by the leaderboard UI lives — there is **no separate
`round_scores` table**.

| Column                                                | Role in the UI                                        |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `tournament_id`, `golfer_id`, `espn_player_id`        | keys + join to `golfers`/`picks`                      |
| `espn_display_name`, `country`                        | rendered in row                                       |
| `position_display`, `position_numeric`, `is_tie`      | final (R4) tournament position + tie flag             |
| `status_type`, `status_short_detail`                  | active / cut / withdrawn / DQ discrimination          |
| `total_strokes`, `score_to_par`                       | final aggregate (R4 view "To Par")                    |
| `round_1`, `round_2`, `round_3`, `round_4`            | per-round strokes; used as fallback for position calc |
| `position_r1`, `position_r2`, `position_r3`, `position_r4` | per-round positions captured from ESPN linescores  |
| `rounds_completed`, `withdrew_after_round`            | metadata, not currently rendered                      |
| `imported_at`                                         | last ingest timestamp                                 |

Constraints:

- PK `id`
- FK `tournament_id` → `tournaments.id` CASCADE
- FK `golfer_id` → `golfers.id` SET NULL
- UNIQUE `(tournament_id, espn_player_id)` — the idempotent upsert key
  used by the ingest server fn
- RLS: public read; service-role write.

The `position_rN` columns come from ESPN's `linescores[i].currentPosition`,
which ESPN captures when each golfer finishes the round and does **not**
recalculate afterwards. This is why the Major7s view recomputes positions
from cumulative strokes for completed rounds (see §4.2).

### 2.4 `picks` (Major7s entries)

- PK `id`
- FK `tournament_id` → `tournaments.id` CASCADE
- FK `team_id` → `teams.id` CASCADE
- FK `golfer_id` → `golfers.id` NO ACTION
- UNIQUE `(tournament_id, team_id, bucket)` — exactly one pick per
  bucket 1..7 per team per tournament
- Trigger `enforce_pick_lock` blocks non-admin writes after
  `tournaments.submission_deadline`
- RLS: team owner + admin

### 2.5 `teams`

- PK `id`
- FK `owner_user_id` → `auth.users.id` CASCADE
- UNIQUE `(owner_user_id, nickname)`
- Exactly one row per user has `is_primary = true`
- RLS: owner + admin

### 2.6 `tournament_scores` + `tournament_score_picks` (settled snapshot)

Written by `calculateMajor7sScores()` after every ESPN import. The
leaderboard **read path does not query these tables** — they exist for
Hall of Fame, archive, and reporting.

- `tournament_scores`: one row per (tournament, team) with
  `total_points`, `thru_cut`, `position_display`, `position_numeric`,
  UNIQUE `(tournament_id, team_id)`.
- `tournament_score_picks`: one row per (score, bucket) with
  `golfer_name` snapshot, `points`, `status_type`, `counted`,
  UNIQUE `(tournament_score_id, bucket)`.

### 2.7 What the prompt asked about but does not exist

- **`Players` master table** — no. Golfer identity is per-tournament in
  `golfers`.
- **`Round_Scores`** — no. R1–R4 strokes and per-round positions are
  columns on `tournament_leaderboard`.
- **`User_Teams` / `Major7s_Entries`** — these are `teams` + `picks`
  (bucket 1..7).
- **Prisma schema** — none. See `supabase/migrations/` and the generated
  types file.

---

## 3. Data population

### 3.1 Read: TanStack Query in the browser

There is no Remix-style server `loader`. The route component runs three
independent `useQuery` calls; TanStack Query dedupes, caches, and
retries.

Header query (`tournament.$id.leaderboard.tsx:106-114`):

```tsx
const { data: tournament } = useQuery({
  queryKey: ["tournament-leaderboard-header", id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("tournaments").select("id, name, location, status").eq("id", id).single();
    if (error) throw error;
    return data;
  },
});
```

Leaderboard rows query (`:116-126`) selects every column the UI needs in
one round-trip — including `position_r1..r4` so the round toggle can
work without a second query.

My-picks query (`:128-139`) is gated on `activeTeam?.id` and only fetches
the `golfer_id`s so the tournament table can highlight the current
user's picks with `bg-amber-50`.

Major7s picks query (`:838-863`) is **paginated in 1000-row pages**:

```tsx
const PAGE = 1000;
for (let page = 0; page < 100; page++) {
  const from = page * PAGE;
  const { data, error } = await supabase.from("picks")
    .select("team_id, bucket, golfer_id")
    .eq("tournament_id", tournamentId)
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;
  ...
  if (data.length < PAGE) break;
}
```

Rationale (from the inline comment): Masters 2026 had 183 teams × 7
picks = 1,281 rows. PostgREST's default row ceiling silently truncated
the response, dropping teams past row 1000 to 0 points. The paginated
loop restored them.

Teams query (`:866-882`) derives the roster from `tournament_scores`
joined to `teams` — this is the one place the read path touches the
settled scores table, and only to enumerate which teams participated.

### 3.2 Write: ESPN ingest server function

Located in `src/lib/espn-leaderboard.functions.ts`. High-level pipeline:

1. Fetch ESPN scoreboard/leaderboard JSON for the configured
   `espn_event_id`.
2. Normalise every ESPN display name via `normalizeName()`
   (`:11-19`) — lowercase, strip diacritics, collapse non-alphanumerics —
   and match against `public.golfers` for this tournament. Unmatched
   rows fall back to `picks_helper` (a `(helper_name, espn_player_id)`
   lookup that admins maintain manually for ambiguous cases).
3. UPSERT `tournament_leaderboard` on the composite key
   `(tournament_id, espn_player_id)`.
4. Call `calculateMajor7sScores(tournamentId, userId)` which:
   - reads all leaderboard rows for the tournament,
   - joins them to `picks` + `golfers`,
   - assigns `NON_FINISHER_POINTS = 100` to any pick whose
     `status_type` is not `STATUS_FINISH`,
   - takes best 5 of 7 per team,
   - writes `tournament_scores` + `tournament_score_picks`.

### 3.3 Edge cases

- **CUT vs WD.** ESPN maps both to `status_type = 'STATUS_CUT'`. WD is
  distinguished from CUT by looking for `"WD"` in
  `status_short_detail`. The UI helper is
  `isWithdrawn()` (`tournament.$id.leaderboard.tsx:52-56`).
- **DQ / DNS.** These land under the generic non-finisher branch in
  `calculateMajor7sScores`: `isFinishedStatus()` (`:31-34`) returns true
  only for `STATUS_FINISH`, so anything else scores 100.
- **Missing per-round position.** For an active player mid-round the
  ESPN feed may not yet have `position_rN` populated. The Major7s
  compute layer carries forward the previous round's position and
  marks the cell `is_latest_carryforward` so the breakdown can render
  it in italics (`:753-761`).
- **In-progress round detection.** `getInProgressRound()` (`:618-626`)
  finds any golfer whose `status_type === 'STATUS_IN_PROGRESS'` and
  returns the highest round they have strokes for. When the round the
  user is viewing matches, `buildRoundPositionMap()` uses ESPN's live
  `position_rN` instead of recomputing from cumulative strokes —
  otherwise a partial 66-through-17 stroke total would corrupt the
  ranking.
- **`MIN_COMPLETE = 58`.** In the cumulative-strokes path
  (`:657`) any round-stroke value under 58 is treated as incomplete
  and the golfer is dropped from that round's ranking. Comment in
  source: "no completed major round has ever been below 61".

---

## 4. Dual-view logic

### 4.1 State model

Both views live inside the same route component and share one round
selector so switching views does not reset the round.

```tsx
const [view, setView]   = useState<View>("major7s");   // "tournament" | "major7s"
const [round, setRound] = useState<Round>("r4");       // "r1" | "r2" | "r3" | "r4"
```

Defaults: **Major7s / R4**. R4 is the "settled" view; the auto-snap
effect (§5) demotes to a lower round if R4 has no data yet.

### 4.2 Tournament view

Component: `TournamentTable` (`:362`) rendering `TourneyRow` (`:476`).

Grouping and sorting are round-aware and rebuilt in a `useMemo` at
`:180-227`:

- **R4 view.** Rows split into `active` and `cut` groups.
  `active` sorts by `position_numeric` then `total_strokes`; `cut`
  sorts by `score_to_par` then `total_strokes`. A `Missed Cut /
  Withdrew` divider row is inserted between them (`:445-451`).
- **R1 / R2 / R3 view.** Filter to rows with the round's `position_rN`
  populated, sort by it. No cut bucket — golfers outside the set
  simply hadn't played this round.

Tie detection differs by round:

- R4 uses the row's own `is_tie` flag (set by ESPN).
- R1–R3 derive ties inside `TournamentTable` (`:382-396`) by counting
  how many rows share the same `position_rN` value; ties become a
  `Set<number>` (`tiedPositions`) that `TourneyRow` consults to
  prepend `T`.

Δ (delta) rendering (`:520-547`):

- `showDelta = round !== "r1"` — R1 has no previous round to compare.
- For R2/R3 the prior position is `position_r{n-1}`; for R4 it is
  `position_r3`.
- Positive delta = climbed → green `↑n`; negative = dropped → red
  `↓n`; zero or missing = muted em-dash.

"Mine" highlight: any row whose `golfer_id` is in the
`myPickGolferIds` set gets `bg-amber-50`.

Column visibility (`TourneyCols` at `:336`):

| Column  | Shown when                                    |
| ------- | --------------------------------------------- |
| Pos     | always                                        |
| Δ       | `round !== "r1"`                              |
| Golfer  | always                                        |
| To Par  | `round === "r4"`                              |
| R1      | always                                        |
| R2      | `round ∈ { "r2", "r3", "r4" }`                |
| R3      | `round ∈ { "r3", "r4" }`                      |
| R4      | `round === "r4"`                              |

### 4.3 Major7s view

Component tree (top-down):

```
MajorSevensTable              (:1113)  — mode toggle, panels, table shell
  ├─ RoundActiveTeamPanel     (:1044)  — pinned "Your Team" card
  └─ RoundExpandableTeamRow   (:988)   — one per team, expands to
       └─ RoundPickBreakdown  (:911)     per-round position matrix
```

Scoring runs through the hook `useMajor7sRoundScores` (`:830-908`)
which calls `computeRoundScores` (`:698-827`). Rules encoded there:

- **Best 5 of 7.** Every team's 7 picks are scored, sorted, and the
  lowest 5 sum to the team total. `counted = true` on those five.
- **Standard Competition Ranking** for team position. Ties share
  position and both rows get `is_tie = true` (`:813-824`).
- **WD.** Always 100 points, every round (`:721-732`).
- **CUT.** Real R1 position, 100 from R2 onwards (`:734-747`).
- **Non-finisher fallback.** Any active player with no
  `position_rN` and no prior round to carry forward from scores 100.
- **Δ vs previous round.** After computing scores for the current
  round, the hook recomputes scores for the prior round and diffs
  positions per team (`:889-898`).

BOTR ("Best Of The Rest") toggle: only available on R3/R4 when
`thru_cut !== null`. Filters to teams with fewer than 5 picks through
the cut (`:1162-1165`). A dashed banner appears if the current user's
team is ≥5 through the cut and therefore excluded (`:1236-1240`).

Medals: `PositionMedal` (`:1283`) overlays gold/silver/bronze radial
gradients on positions 1/2/3, but only when `r4Complete` is true —
defined as R4 view + no in-progress round + at least one row with
`round_4` populated (`:1179-1190`).

### 4.4 Why the Major7s view recomputes instead of reading
`tournament_scores`

`tournament_scores` only stores the *final* per-team totals — no
per-round breakdown. The UI needs R1/R2/R3/R4 slices with per-round
positions, ties, and Δ movement, which requires re-scoring from
`tournament_leaderboard` on every round switch. The settled snapshot
remains the single source of truth for Hall of Fame and history.

---

## 5. Round-by-round filtering

### 5.1 `RoundToggle` component

`RoundToggle` (`:300-331`) renders one button per available round. It
does **not** render disabled placeholders for future rounds — they are
hidden entirely. Rationale: an unpopulated `position_r3` looks
indistinguishable from a valid round with 156 CUTs; hiding avoids the
false-affordance of a clickable-but-empty tab.

The toggle is not rendered at all when `items.length <= 1`
(`:314`) — no point offering a single-tab selector.

### 5.2 `maxRound` derivation

`maxRound` (`:151-164`) walks the leaderboard rows once and returns the
highest round with any `position_rN` populated. A special case unlocks
R3 the moment the cut has happened, even before R3 positions exist:

```tsx
// Post-cut: R2 data exists + field has been cut → surface R3 view
if (max === 2 && cutCount > 5) max = 3;
```

`cutCount` counts rows whose `status_type` is `STATUS_CUT` /
`STATUS_WITHDRAWN`. Threshold of 5 avoids a stray WD in R1 unlocking
R3 prematurely.

### 5.3 Auto-snap effect

When `maxRound` changes (typically after an ESPN import) the effect at
`:170-177` snaps the current `round` down to the latest available
round if the user was on a round that no longer has data. This
handles both first-load and navigation between tournaments of
different completeness.

### 5.4 Round-aware column visibility

Documented in §4.2 (Tournament view) and §4.3 (Major7s view). Both
view components take the shared `round` prop and toggle columns
locally — there is no revalidation, no refetch. The Query cache for
the underlying rows is reused; only the in-memory grouping/sort
`useMemo` recomputes.

---

## 6. UI component inventory

| Component                 | File location                                              | Purpose                                                        |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `LeaderboardView`         | `tournament.$id.leaderboard.tsx:94`                        | Route component, orchestrates queries + view/round state       |
| `RoundToggle`             | `:300`                                                     | R1..R4 tab bar; hides unavailable rounds                       |
| `TournamentTable`         | `:362`                                                     | ESPN leaderboard grid, active + cut groups                     |
| `TourneyRow`              | `:476`                                                     | One golfer row, per-round position label, Δ cell, R1..R4 cells |
| `TourneyCols`             | `:336`                                                     | `<colgroup>` for the tournament table                          |
| `MajorCols`               | `:68`                                                      | `<colgroup>` shared by every Major7s table                     |
| `MajorSevensTable`        | `:1113`                                                    | Major7s view shell + ALL/BOTR toggle + team count              |
| `RoundActiveTeamPanel`    | `:1044`                                                    | Pinned amber "Your Team" panel                                 |
| `RoundExpandableTeamRow`  | `:988`                                                     | One team row that expands to reveal picks                      |
| `RoundPickBreakdown`      | `:911`                                                     | Per-round position matrix for a team's 7 picks                 |
| `Major7sDeltaCell`        | `:84`                                                      | Shared Δ arrow rendering                                       |
| `PositionMedal`           | `:1283`                                                    | Gold/silver/bronze medal overlay for R4-complete podium        |

### 6.1 Visual affordances actually implemented

- **Up/down movement arrows.** The Δ column renders green `↑n` for
  positions climbed and red `↓n` for positions dropped
  (Tournament view: `:539-543`; Major7s view: shared
  `Major7sDeltaCell` at `:84-92`). Muted em-dash for no change or no
  prior round.
- **"Mine" row highlight.** `bg-amber-50` on any tournament row whose
  golfer is in the user's picks (`:549`); same colour on the pinned
  Major7s "Your Team" panel (`:1051-1054`).
- **Cut-line indicator.** In the Tournament R4 view a full-width
  divider row `Missed Cut / Withdrew` separates active players from
  cut/WD players (`:445-451`). There is no separate horizontal line
  above the cut position — the divider row is the indicator.
- **Podium medals.** Radial-gradient gold/silver/bronze pills with
  inset highlight and drop shadow, applied only when the R4 round is
  complete (`:1179-1190` for the gate, `:1283-1315` for the styles).
- **Active-round highlight.** The selected round button in
  `RoundToggle` uses `bg-foreground text-background`; all other tabs
  are muted (`:322-323`).
- **Sticky Major7s header.** `sticky top-16 z-10` on the Major7s table
  header (`:1245`) keeps column labels visible while scrolling long
  rosters.
- **Expand chevron.** `ChevronDown` rotates 180° when a team row is
  expanded (`:1023`, `:1088`), with a 300 ms `max-height + opacity`
  transition on the reveal panel (`:1030`, `:1094`).
- **Tie prefix.** `T` prefix on tied positions — in R4 from ESPN's
  `is_tie`; in R1–R3 derived per-round; in Major7s from
  `computeRoundScores`.

### 6.2 Tailwind conventions worth knowing

- Every Major7s table declares `MajorCols` + `tableLayout: fixed` so
  Pos / Δ / Team / Points / Thru Cut / chevron columns align across
  the pinned "Your Team" panel, the main table, and the breakdown
  panel. Changing one width means changing `MajorCols`.
- `NON_FINISHER_POINTS = 100` is duplicated (once in the route,
  once in the server function). Both must move together.

---

## 7. Known constraints and non-goals

- **No SSR.** The route renders blank until Query resolves. Acceptable
  because it lives under `_authenticated`, so unauth users are
  redirected before they see anything.
- **Ingest is admin-triggered.** No pg_cron, no scheduled task. The
  Tournament view and the Major7s on-the-fly view are only as fresh
  as the last `Import ESPN` click on the tournament admin page.
- **Per-round positions require ESPN linescores.** Older tournaments
  whose archive predates `linescores[].currentPosition` will have
  `maxRound === 0` and no round toggle at all — only the final R4
  view renders.
- **`tournament_scores` and the on-the-fly Major7s view can drift.**
  The settled snapshot is written once per ingest and reflects the
  best 5 of 7 at that moment; the on-the-fly view can differ during
  a live round (e.g. carry-forward positions). Hall of Fame /
  archive intentionally uses the settled snapshot.
