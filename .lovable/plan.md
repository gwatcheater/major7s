## Goal

Create `docs/data-dictionary.md` — a comprehensive markdown reference of every table in the Major7s Lovable Cloud (`public` schema) database, including columns, types, descriptions, primary keys, foreign keys, unique constraints, and relationship notes.

## Approach

1. Pull authoritative schema from the live database:
   - `information_schema.columns` for all column metadata
   - `information_schema.table_constraints` + `key_column_usage` + `constraint_column_usage` for PK / FK / UNIQUE
   - `pg_indexes` for supporting indexes
   - `pg_description` (`obj_description` / `col_description`) for any existing comments
2. Cross-reference with `src/integrations/supabase/types.ts` and `handle_new_user` / RLS context already in code to write accurate, human-readable descriptions for each column (especially enums like `profile_status`, `app_role`).
3. Author `docs/data-dictionary.md` with a consistent per-table layout.

## Document structure

```text
# Major7s Data Dictionary
- Overview (schema = public, generated <date>, source of truth)
- Entity relationship summary (ASCII map of how tables connect)
- Enums (app_role, profile_status, ...)
- Tables (alphabetical), each with:
    - Purpose (1–2 sentences)
    - Columns table: name | type | nullable | default | description
    - Primary key
    - Foreign keys (this table → other) with on-delete behaviour
    - Referenced by (other tables → this)
    - Unique constraints / notable indexes
    - RLS / access notes (one line: who can read/write)
```

Tables to cover (17): `admin_audit`, `blog_posts`, `email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `golfers`, `picks`, `picks_helper`, `profiles`, `suppressed_emails`, `teams`, `tournament_leaderboard`, `tournament_results`, `tournament_score_picks`, `tournament_scores`, `tournaments`, `user_roles`.

Relationship highlights to call out explicitly:
- `profiles.id` → `auth.users.id` (1:1, managed)
- `teams.owner_user_id` → `auth.users.id`; one `is_primary` team per user
- `picks` links `teams` + `tournaments` + `golfers` (composite uniqueness on team+tournament+bucket)
- `golfers.tournament_id` → `tournaments.id` (per-tournament field)
- `tournament_leaderboard` / `tournament_scores` / `tournament_score_picks` / `tournament_results` → `tournaments.id` (and `golfer_id` where applicable)
- `user_roles.user_id` → `auth.users.id` (separate from `profiles` for security)
- `blog_posts.author_id` → `auth.users.id`, optional `tournament_id` → `tournaments.id`
- Email tables (`email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`) — standalone, keyed by `email` text not user id

## Out of scope

- `auth`, `storage`, `pgmq`, `net`, `supabase_functions` schemas (not user-managed)
- Database functions / triggers (already documented in `docs/email-handover.md` for email pipeline)
- Generating this from a build step — it's a one-shot doc snapshot, dated at top

## Deliverable

Single file: `docs/data-dictionary.md`.
