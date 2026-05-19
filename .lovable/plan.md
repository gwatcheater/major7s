# Multi-Team User Management + Shadow Mode Team Switcher

## 1. New file: `src/components/admin/users-directory-tab.tsx`

Self-contained tab exporting `UsersDirectoryTab`.

- **Master table** — queries `profiles` (id, nickname, email, first/last name, team_nickname, status) ordered by `created_at desc`. Columns: User · Email · Primary Team · Status badge · Actions. Per row: **"⚙️ Manage Account"** button → opens dialog.
- **`ManageAccountDialog`** (shadcn `Dialog`, title **"Account Configuration Panel"**, max-w-2xl, scrollable):
  - Sub-section card **"Registered Team Entries"** running `useQuery(["admin-user-teams", user.id])` against `teams where owner_user_id = user.id`, sorted `is_primary desc, created_at asc`.
  - Each team row: `<Input>` pre-filled with nickname (tracked in local `edits` state) · **Primary** badge (emerald) or **Secondary** badge (slate) · **🗑️ Delete** button, disabled when `is_primary`. Delete triggers two sequential `window.confirm()` prompts, then `supabase.from("teams").delete().eq("id", team.id)`, toast, `refetch()`, and `qc.invalidateQueries({queryKey:["teams"]})`.
  - Footer block **"Register New Team Entry"**: text input + **＋ Add Team** button → `supabase.from("teams").insert({ owner_user_id: user.id, nickname, is_primary: false })`, toast, refetch.
  - Bottom dialog actions: **Close** and **Save Configuration Changes**. Save loops over edited nicknames, runs `supabase.from("teams").update({nickname}).eq("id",team.id)` per row, shows toast **"User team configuration updated successfully"**, clears `edits`, refetches.
  - Local state (`edits`, `newTeamName`) resets in a `useEffect([user.id])` so switching users between dialogs doesn't bleed values.

RLS already permits these writes for admins (`Teams: owner inserts/updates/deletes own` policies include `has_role(auth.uid(),'admin')`), so no migration is required.

## 2. Edit: `src/routes/_authenticated/admin.index.tsx`

- Import `UsersDirectoryTab` and a `Users` lucide icon (already imported).
- `TabsList`: bump `md:grid-cols-4` → `md:grid-cols-5`, add a fifth `<TabsTrigger value="users">` labeled **"Users"**.
- Add matching `<TabsContent value="users"><UsersDirectoryTab /></TabsContent>` after the Submissions tab content.

No other edits to the existing four tabs.

## 3. Edit: `src/components/impersonation-banner.tsx`

Expand the amber banner row to host a team picker next to the name:

- Bring in `useEffect`, `useState`, `supabase`, `useTeams` from `@/hooks/use-teams`, and shadcn `Select` primitives (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`).
- When `impersonatingId` is set, run `useQuery(["impersonated-teams", impersonatingId])` → `teams where owner_user_id = impersonatingId` (ordered `is_primary desc, created_at asc`).
- Read current selection from `localStorage.getItem(\`major7s.activeTeamId:${impersonatingId}\`)`, initialise to that or to the primary team's id once data lands.
- Render label **"Active Lineup Entry:"** + `<Select>` of team nicknames. Disable while loading or when 0 teams.
- `onValueChange(id)`:
  1. `localStorage.setItem(\`major7s.activeTeamId:${impersonatingId}\`, id)`
  2. `useTeams().refetch()` (call the hook at component top, use the returned `refetch`)
  3. `queryClient.invalidateQueries({ queryKey: ["picks"] })` and `["roster-status"]` so the lineup page re-binds to the new team.
  4. Local state update to keep the trigger label in sync.
- Update the team text in the banner heading to reflect the currently selected team's nickname instead of `profile.team_nickname`.

This lets the admin toggle Team A/B/C for the impersonated user while staying in Shadow Mode; the existing `use-teams` hook (`STORAGE_KEY_BASE = "major7s.activeTeamId"`) already keys off the same `major7s.activeTeamId:<effectiveId>` localStorage entry, so writing to it + refetch propagates instantly to `tournament.$id.lineup.tsx` and any other team-scoped view.

## Technical notes

- All Supabase calls use the existing browser client; admin RLS handles authorization. No new server functions, no schema migrations.
- React Query invalidations target `["teams"]`, `["picks"]`, `["roster-status"]` — the same keys already used by `impersonation-context.tsx#invalidateScopedQueries`.
- The "Manage Account" button uses the existing shadcn `Dialog` (already present at `src/components/ui/dialog.tsx`) and `Badge` (`src/components/ui/badge.tsx`). No new dependencies.
- Double-confirmation uses two `window.confirm()` calls to keep scope minimal; an upgrade path to `AlertDialog` is possible later if desired.

## Files touched

```text
+ src/components/admin/users-directory-tab.tsx   (new, ~250 lines)
~ src/routes/_authenticated/admin.index.tsx      (tab list + content, ~6 lines)
~ src/components/impersonation-banner.tsx        (rewrite, ~80 lines)
```
