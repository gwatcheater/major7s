## Add external web link to tournament cards

Per-tournament external URL (e.g. the official tournament website) that admins can set, displayed as an "Official Site" link on the tournament hub and on the home/archive list cards.

### 1. Database

Migration adds a nullable `external_url` text column to `public.tournaments`. No new RLS policies needed (existing ones cover the column).

```sql
ALTER TABLE public.tournaments ADD COLUMN external_url text;
```

### 2. Admin UI (`src/routes/_authenticated/admin.index.tsx`)

- Add `external_url` to the `Create Tournament` form and `Edit Tournament Details` form (text input, optional, `https://…` placeholder).
- Include it in the insert/update payloads and in the admin tournaments `select(...)` list (line ~484).

### 3. Tournament hub (`src/routes/_authenticated/tournament.$id.tsx`)

When `t.external_url` is set, render an "Official Site" row above the Leaderboard nav row using the same nav-row styling, with an `ExternalLink` icon. It opens in a new tab (`target="_blank" rel="noopener noreferrer"`).

### 4. List cards (`home.tsx` and `archive.tsx`)

Add a small "Official Site ↗" pill inside the card body when `external_url` is set. The pill stops click propagation and opens in a new tab so it doesn't trigger the full-card link to the hub. Extend the `Tournament` interface in both files with `external_url?: string | null`.

### Technical details

- Link target opens in a new tab with `rel="noopener noreferrer"`.
- The list-card external link uses `z-20 pointer-events-auto` + `onClick={(e) => e.stopPropagation()}` to sit above the full-card overlay link (same pattern already used for the "Picks" button on home).
- No changes to `src/lib/tournament-link.ts` — that helper stays focused on internal hub routing.
- The Supabase TypeScript types regenerate automatically after the migration; no manual edit to `src/integrations/supabase/types.ts`.
