# Major7s Data Dictionary

Schema: `public` (Lovable Cloud / Supabase Postgres)
Generated: 2026-06-28 — sourced from `information_schema` + project code.

This document covers every application-owned table in the `public` schema. The Supabase-managed schemas (`auth`, `storage`, `pgmq`, `net`, `realtime`, `supabase_functions`, `vault`) are out of scope. Database functions and triggers are documented in [`docs/email-handover.md`](./email-handover.md) and inline in migrations.

---

## Entity relationship overview

```text
auth.users (managed)
   │  1:1
   ├──< profiles (id)
   │  1:N
   ├──< teams (owner_user_id)            ── one is_primary per user
   │           │  1:N
   │           ├──< picks (team_id) >── tournaments
   │           │                  │
   │           │                  └─── golfers (golfer_id)
   │           ├──< tournament_scores >── tournaments
   │           │           │  1:N
   │           │           └──< tournament_score_picks
   │           └──< tournament_results >── tournaments
   ├──< user_roles (user_id, role)        ── role storage (NEVER on profiles)
   └──< blog_posts (author_id) ─?─ tournaments

tournaments
   ├──< golfers (tournament_id)           ── per-tournament field
   └──< tournament_leaderboard (tournament_id, espn_player_id)

Email pipeline (standalone, keyed by email text)
   email_send_log · email_send_state · email_unsubscribe_tokens · suppressed_emails

Reference
   admin_audit · picks_helper
```

---

## Enums

| Type | Values |
|---|---|
| `app_role` | `admin`, `user` |
| `profile_status` | `pending`, `approved`, `rejected`, `suspended` |
| `tournament_status` | `upcoming`, `open_for_picks`, `picks_closed`, `live`, `completed` |

---

## Tables

### `admin_audit`
Append-only log of privileged admin actions (role grants, status changes, impersonation, admin pick edits, team renames).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `actor_id` | uuid | YES | — | Admin who performed the action (`auth.uid()` at insert time). |
| `action` | text | NO | — | Action code, e.g. `role.grant`, `profile.status`, `impersonation.start`, `picks.admin_edit`. |
| `target_user` | uuid | YES | — | User the action affected. |
| `detail` | jsonb | NO | `'{}'` | Action-specific payload (from/to, tournament_id, etc.). |
| `created_at` | timestamptz | NO | `now()` | When the event happened. |

- **PK:** `id`
- **FKs:** none enforced (logical refs to `auth.users`).
- **RLS:** admins read; writes only via SECURITY DEFINER trigger/RPC functions.

---

### `blog_posts`
Tournament recaps and standalone posts authored by admins.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `author_id` | uuid | NO | — | Author user id (logical FK to `auth.users.id`). |
| `tournament_id` | uuid | YES | — | Optional tournament the post belongs to. |
| `title` | text | NO | — | Post title. |
| `body` | text | NO | `''` | Markdown body. |
| `image_url` | text | YES | — | Hero image (stored in `blog-images` bucket). |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | `now()` | Auto-maintained via `set_updated_at` trigger. |

- **PK:** `id`
- **FKs:** `tournament_id` → `tournaments.id` **ON DELETE SET NULL**.
- **RLS:** public read; admin write.

---

### `email_send_log`
Audit trail of every email queued/sent via the Lovable email pipeline.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `message_id` | text | YES | — | Provider message id once accepted. |
| `template_name` | text | NO | — | Template key (e.g. `picks-confirmation`, `recovery`). |
| `recipient_email` | text | NO | — | Destination address. |
| `status` | text | NO | — | `queued` / `sent` / `failed` / `suppressed`. |
| `error_message` | text | YES | — | Provider/transport error if `status='failed'`. |
| `metadata` | jsonb | YES | — | Idempotency keys, render context refs, etc. |
| `created_at` | timestamptz | NO | `now()` | |

- **PK:** `id`
- **RLS:** admin read; service-role write.

---

### `email_send_state`
Singleton row holding runtime knobs for the email worker (throttle, batch size, TTLs).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | integer | NO | `1` | Sentinel — always 1. |
| `retry_after_until` | timestamptz | YES | — | Pause sends until this time (provider 429 backoff). |
| `batch_size` | integer | NO | `10` | Messages pulled per worker tick. |
| `send_delay_ms` | integer | NO | `200` | Inter-message delay inside a batch. |
| `auth_email_ttl_minutes` | integer | NO | `15` | Discard auth emails older than this. |
| `transactional_email_ttl_minutes` | integer | NO | `60` | Discard transactional emails older than this. |
| `updated_at` | timestamptz | NO | `now()` | |

- **PK:** `id` (always = 1)
- **RLS:** admin read/write; service-role read.

---

### `email_unsubscribe_tokens`
One-click unsubscribe tokens emitted in `List-Unsubscribe` headers and footer links.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `token` | text | NO | — | Opaque token included in email links. **UNIQUE** |
| `email` | text | NO | — | Address the token unsubscribes. **UNIQUE** (one active token per address) |
| `created_at` | timestamptz | NO | `now()` | |
| `used_at` | timestamptz | YES | — | First-use timestamp; subsequent uses are no-ops. |

- **PK:** `id` — **Unique:** `token`, `email`
- **RLS:** service-role only; consumed by `/email/unsubscribe`.

---

### `golfers`
Field for a given tournament. One row per (tournament, golfer).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `tournament_id` | uuid | NO | — | Owning tournament. |
| `golfer_name` | text | NO | — | Display name. |
| `owgr_rank` | integer | YES | — | World ranking snapshot. |
| `bucket_number` | smallint | NO | — | Bucket (tier) the golfer belongs to for this tournament (1–7). |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | `now()` | |

- **PK:** `id`
- **FKs:** `tournament_id` → `tournaments.id` **ON DELETE CASCADE**.
- **Unique:** `(tournament_id, golfer_name)`.
- **Referenced by:** `picks.golfer_id`, `tournament_leaderboard.golfer_id` (SET NULL), `tournament_score_picks.golfer_id` (SET NULL).

---

### `picks`
A team's submitted golfer for each bucket of a tournament.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `tournament_id` | uuid | NO | — | Tournament being entered. |
| `team_id` | uuid | NO | — | Owning team. |
| `bucket` | smallint | NO | — | Bucket number 1–7. |
| `golfer_id` | uuid | NO | — | Selected golfer (must belong to same tournament). |
| `submitted_at` | timestamptz | NO | `now()` | First submission time. |
| `last_edited_at` | timestamptz | NO | `now()` | Most recent edit. |
| `tweak_count` | integer | NO | `0` | Number of post-submission edits. |

- **PK:** `id`
- **FKs:** `tournament_id` → `tournaments.id` CASCADE · `team_id` → `teams.id` CASCADE · `golfer_id` → `golfers.id` NO ACTION.
- **Unique:** `(tournament_id, team_id, bucket)` — one pick per bucket per team.
- **Trigger:** `enforce_pick_lock` blocks non-admin writes after `tournaments.submission_deadline`.
- **RLS:** team owner + admin.

---

### `picks_helper`
Reference lookup mapping ESPN player ids to internal display names (used during score import to disambiguate).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `helper_name` | text | NO | — | Internal canonical key. **PK part 1** |
| `espn_player_id` | text | NO | — | ESPN player id. **PK part 2** |
| `golfer_name` | text | NO | — | Display name resolved at import. |
| `helper_info` | text | NO | — | Free-text notes about the mapping. |

- **PK:** composite `(helper_name, espn_player_id)`
- **RLS:** admin read/write.

---

### `profiles`
Per-user application profile. One-to-one with `auth.users`. **Do not store roles here** (see `user_roles`).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | — | Same as `auth.users.id`. **PK + FK** |
| `nickname` | text | NO | — | Display name. |
| `email` | text | YES | — | Cached email (denormalised from `auth.users.email`). |
| `status` | profile_status | NO | `'pending'` | Account state — see enum. |
| `first_name` | text | YES | — | |
| `last_name` | text | YES | — | |
| `phone` | text | YES | — | |
| `referral_name` | text | YES | — | "Who referred you" captured at signup. |
| `team_nickname` | text | YES | — | Initial team name from signup. **UNIQUE** when set. |
| `onboarded_at` | timestamptz | YES | — | First time the user completed onboarding. |
| `last_seen_at` | timestamptz | YES | — | Maintained by `LastSeenTracker` (throttled to 5 min). |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | `now()` | |

- **PK:** `id`
- **FKs:** `id` → `auth.users.id` **ON DELETE CASCADE**.
- **Unique:** `team_nickname`.
- **Triggers:** `audit_profile_status`, `protect_profile_status` (non-admins can't change `status`), `notify_admin_on_new_profile` (HTTP webhook on insert).
- **RLS:** users read/update self; admins full access.

---

### `suppressed_emails`
Permanent do-not-send list (unsubscribes, hard bounces, complaints).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `email` | text | NO | — | Suppressed address (lowercased). **UNIQUE** |
| `reason` | text | NO | — | `unsubscribe`, `bounce`, `complaint`, `manual`. |
| `metadata` | jsonb | YES | — | Provider event payload, admin note, etc. |
| `created_at` | timestamptz | NO | `now()` | |

- **PK:** `id` — **Unique:** `email`
- **RLS:** admin read; service-role write.

---

### `teams`
A user's team(s). Each user has at least one team; exactly one is `is_primary`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `owner_user_id` | uuid | NO | — | Team owner (FK → `auth.users.id`). |
| `nickname` | text | NO | — | Team display name. |
| `is_primary` | boolean | NO | `false` | True for the user's active team (one per user). |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | `now()` | |

- **PK:** `id`
- **FKs:** `owner_user_id` → `auth.users.id` **ON DELETE CASCADE**.
- **Unique:** `(owner_user_id, nickname)` — a user can't have two teams with the same name.
- **Referenced by:** `picks.team_id`, `tournament_scores.team_id`, `tournament_results.team_id` (all CASCADE).
- **Triggers:** `audit_teams`. Primary-team toggling goes through `public.set_primary_team()`.
- **RLS:** owner + admin read/write; admin-only `is_primary` flip.

---

### `tournaments`
A scheduled event with a window for picks, a leaderboard, and (eventually) results.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `name` | text | NO | — | Display name. |
| `location` | text | NO | — | Venue / city. |
| `logo_url` | text | YES | — | Event logo. |
| `start_date` | date | NO | — | First round date. |
| `end_date` | date | NO | — | Final round date. |
| `submission_deadline` | timestamptz | NO | — | Cutoff for pick edits (London time enforced in UI). |
| `status` | tournament_status | NO | `'upcoming'` | Lifecycle — see enum. |
| `bucket_sizes` | jsonb | NO | `{"1":10,...,"7":0}` | Map of bucket → number of golfers in that tier. |
| `recap_blog` | text | YES | — | Inline recap fallback when no `blog_posts` exist. |
| `espn_event_id` | text | YES | — | ESPN event id for leaderboard ingest. |
| `external_url` | text | YES | — | "Live leaderboard" outbound link shown on tournament card. |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | `now()` | |

- **PK:** `id`
- **Referenced by:** `golfers`, `picks`, `blog_posts`, `tournament_leaderboard`, `tournament_scores`, `tournament_results` (all CASCADE except `blog_posts` which is SET NULL).
- **RLS:** public read; admin write.

---

### `tournament_leaderboard`
Per-golfer scoring snapshot ingested from ESPN. One row per (tournament, ESPN player).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `tournament_id` | uuid | NO | — | FK → `tournaments.id`. |
| `golfer_id` | uuid | YES | — | FK → `golfers.id` (nullable when no mapping yet). |
| `espn_player_id` | text | NO | — | ESPN player id. |
| `espn_display_name` | text | NO | — | Name as ESPN returns it. |
| `country` | text | YES | — | Country code. |
| `position_display` | text | YES | — | e.g. `T4`, `CUT`. |
| `position_numeric` | integer | YES | — | Numeric ranking (ties share value). |
| `is_tie` | boolean | YES | — | True when `position_display` is `T…`. |
| `status_type` | text | YES | — | `active`, `cut`, `wd`, `dq`, `finished`. |
| `total_strokes` | integer | YES | — | Sum of completed rounds. |
| `score_to_par` | integer | YES | — | Negative = under par. |
| `round_1`–`round_4` | integer | YES | — | Strokes per round. |
| `position_r1`–`position_r4` | integer | YES | — | Position after each round. |
| `rounds_completed` | integer | YES | `0` | Number of rounds finished. |
| `withdrew_after_round` | integer | YES | — | Round at which the player withdrew, if any. |
| `status_short_detail` | text | YES | — | ESPN short-form status text. |
| `imported_at` | timestamptz | NO | `now()` | Last ingest timestamp. |

- **PK:** `id`
- **FKs:** `tournament_id` → `tournaments.id` CASCADE · `golfer_id` → `golfers.id` SET NULL.
- **Unique:** `(tournament_id, espn_player_id)` — idempotent upsert key.
- **RLS:** public read; service-role write.

---

### `tournament_scores`
Calculated team score for a tournament. One row per (tournament, team).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `tournament_id` | uuid | NO | — | FK → `tournaments.id` CASCADE. |
| `team_id` | uuid | NO | — | FK → `teams.id` CASCADE. |
| `total_points` | integer | NO | — | Aggregate score. |
| `thru_cut` | integer | NO | — | Picks that made the cut (used for tie-breaks). |
| `position_display` | text | NO | — | e.g. `T2`. |
| `position_numeric` | integer | NO | — | Numeric position. |
| `calculated_at` | timestamptz | NO | `now()` | When the calc ran. |
| `calculated_by` | uuid | YES | — | Admin who triggered the calc (logical ref). |
| `helper_used` | boolean | YES | `false` | True when `picks_helper` mappings were applied. |

- **PK:** `id`
- **Unique:** `(tournament_id, team_id)` — one score row per team per tournament.
- **Referenced by:** `tournament_score_picks.tournament_score_id` CASCADE.
- **RLS:** public read; admin write.

---

### `tournament_score_picks`
Per-bucket breakdown of a `tournament_scores` row. One row per bucket scored.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `tournament_score_id` | uuid | NO | — | FK → `tournament_scores.id` CASCADE. |
| `bucket` | smallint | NO | — | Bucket number 1–7. |
| `golfer_id` | uuid | YES | — | FK → `golfers.id` SET NULL. |
| `golfer_name` | text | NO | — | Snapshot of golfer name at calc time. |
| `points` | integer | NO | — | Points contributed by this pick. |
| `status_type` | text | YES | — | Mirrors leaderboard status (`cut`, `wd`, etc.). |
| `counted` | boolean | NO | `false` | True when this pick's points were included in the team total. |

- **PK:** `id`
- **Unique:** `(tournament_score_id, bucket)`.
- **RLS:** public read; admin write.

---

### `tournament_results`
Final-standing records used to drive the Hall of Fame / archive views. One row per (tournament, team, result_type).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `tournament_id` | uuid | NO | — | FK → `tournaments.id` CASCADE. |
| `team_id` | uuid | NO | — | FK → `teams.id` CASCADE. |
| `result_type` | text | NO | — | e.g. `overall`, `runner_up`, `wooden_spoon`. |
| `position` | integer | NO | — | Finishing position. |
| `context` | jsonb | YES | — | Extra payload (tie-break stats, prize, notes). |
| `calculated_at` | timestamptz | NO | `now()` | |

- **PK:** `id`
- **RLS:** public read; admin write.

---

### `user_roles`
Authoritative role storage. Roles MUST live here, never on `profiles` (privilege-escalation hardening).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `user_id` | uuid | NO | — | FK → `auth.users.id` CASCADE. |
| `role` | app_role | NO | — | `admin` or `user`. |
| `created_at` | timestamptz | NO | `now()` | |

- **PK:** `id`
- **Unique:** `(user_id, role)` — one row per role per user.
- **Checked via:** `public.has_role(_user_id, _role)` (SECURITY DEFINER) — used by every admin RLS policy.
- **Triggers:** `audit_user_roles` writes to `admin_audit` on grant/revoke.
- **RLS:** users read own rows; admins read all; writes admin-only.

---

## Cross-cutting notes

- **`auth.users` is managed by Supabase** — no application FK targets it directly except the four already listed (`profiles.id`, `teams.owner_user_id`, `user_roles.user_id`, `blog_posts.author_id` logical).
- **Cascade strategy:** deleting a `tournament` removes its `golfers`, `picks`, `tournament_leaderboard`, `tournament_scores` (and their child `tournament_score_picks`), and `tournament_results`. `blog_posts.tournament_id` is set NULL so recaps survive.
- **Deleting an `auth.users` row** cascades to `profiles`, `teams` (and their `picks`, `tournament_scores`, `tournament_results`), and `user_roles`. `admin_audit` entries are retained.
- **Pick lock enforcement** is in the DB (`enforce_pick_lock` trigger) — clients cannot bypass it; only `admin` role members can write after `submission_deadline`.
- **Email pipeline tables** are decoupled from user identity by design; they key on the `email` text so suppression survives account deletion.
