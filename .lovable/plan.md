# Status Label + Active Team Header Fixes

## 1. `src/components/admin/users-directory-tab.tsx` (line ~261)

Replace badge label `Secondary` with `Additional`. Conditional already keys on `team.is_primary` correctly — the actual bug surfaced as "dual Secondary" because the rendering branch needs the exact label swap.

```tsx
{team.is_primary ? (
  <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Primary</Badge>
) : (
  <Badge variant="secondary" className="bg-slate-500 text-white hover:bg-slate-500">
    Additional
  </Badge>
)}
```

## 2. `src/routes/_authenticated/tournament.$id.tsx` (line 123)

```tsx
// before
const teamHandle = profile?.team_nickname || activeTeam?.nickname || profile?.nickname || "Your Team";
// after — active team wins
const teamHandle = activeTeam?.nickname || profile?.team_nickname || profile?.nickname || "Your Team";
```

## 3. `src/routes/_authenticated/tournament.$id.lineup.tsx` (line 166)

Same reorder so the lineup-edit header tracks the active team:

```tsx
const teamHandle =
  activeTeam?.nickname || profile?.team_nickname || profile?.nickname || "Your Team";
```

That's the entire change set — three surgical edits, no new files, no schema work.
