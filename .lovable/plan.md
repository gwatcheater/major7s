# Audit: `tournaments.external_url` ("External Link URL")

This is a findings report, not a code change. Decide at the end whether to keep, hide, or remove.

## 1. Origin

- Introduced by you in this chat on request: **"i would like to add an external web link to the tournament card"**.
- Implemented as migration `supabase/migrations/20260618204802_baf3060c-5f55-41da-a15d-7252428d2c65.sql`:
  ```sql
  ALTER TABLE public.tournaments ADD COLUMN external_url text;
  ```
- Not auto-generated, not part of any scanner/security fix, not required by an integration.

## 2. Functionality

- Free-text URL field on the admin **Create / Edit Tournament** forms (`src/routes/_authenticated/admin.index.tsx`, lines ~688 and ~980).
- Stored as nullable `text` on `public.tournaments`.
- On the tournament detail page (`src/routes/_authenticated/tournament.$id.tsx` lines 321-331) it renders a card titled **"Live Leaderboard"** that opens the URL in a new tab.
- No validation beyond `<input type="url">`; no tracking, no redirect handler, no server fn — purely a frontend `<a href>`.

## 3. Data linkage

| Layer | Reference |
|---|---|
| DB column | `public.tournaments.external_url` (text, nullable) |
| Generated types | `src/integrations/supabase/types.ts` (Row/Insert/Update) |
| Admin read | `admin.index.tsx` select list (line 484) |
| Admin write | Create form (line 597) + Edit form (line 925) — direct `supabase.from('tournaments')` insert/update |
| Public read | `home.tsx` and `archive.tsx` tournament shapes (typed but not rendered) |
| Public render | `tournament.$id.tsx` — single `<a>` "Live Leaderboard" tile |
| Docs | `docs/tournament-creation.md`, `docs/data-dictionary.md` |

No FK, no trigger, no edge function, no cron job, no email template, no third-party integration reads or writes this column.

## 4. Dependencies / blast radius

- **Database usage today:** 30 tournaments, **1** has a non-null `external_url`. The other 29 already render fine without it.
- Removing the column would require:
  - dropping references in `admin.index.tsx` (2 forms + select list),
  - removing the "Live Leaderboard" block in `tournament.$id.tsx`,
  - removing the optional field from the `Tournament` types in `home.tsx` / `archive.tsx`,
  - a migration `ALTER TABLE public.tournaments DROP COLUMN external_url`,
  - regenerating `types.ts`,
  - trimming the two docs files.
- Nothing else breaks: no email, no pg_cron, no ESPN sync, no picks logic, no leaderboard import, no analytics depends on it.
- Hiding (instead of dropping) is a one-line change: remove the two Label/Input blocks and the `<a>` render; column stays in DB harmlessly.

## 5. Recommendation options

1. **Keep as-is** — zero work; one tournament already uses it.
2. **Hide UI, keep column** — remove the two form fields and the "Live Leaderboard" tile; data preserved, easy to restore.
3. **Full removal** — UI + render + types + migration drop column. Cleanest but destructive for the 1 existing value.

Tell me which option you want and I'll switch to build mode to execute it.
