## Heads-up: 2 important nuances first

1. **RLS already permits admin writes** to other users' picks / teams / profiles (existing policies use `has_role(auth.uid(), 'admin')`). So impersonation works client-side — no DB or service-role layer needed. The admin's real auth session keeps making the requests; we just *target a different user_id* in the WHERE clauses and inserts. No new server function is required.
2. **`use-teams` is hard-bound to `useAuth().user.id`**. The cleanest place to inject impersonation is inside this hook so every consumer (lineup form, dashboard, header) automatically loads the impersonated user's teams without per-call changes.

---

## File-by-file plan

### NEW · `src/context/impersonation-context.tsx`
- Context + `useImpersonation()` hook exposing:
  - `impersonatingId: string | null`
  - `impersonatedProfile: { id, first_name, last_name, team_nickname, nickname } | null` (auto-fetched when id is set, via `supabase.from("profiles").select(...).eq("id", impersonatingId)`)
  - `isAdminSession: boolean` (mirrors `useAuth().isAdmin`)
  - `startImpersonation(userId)` / `stopImpersonation()`
  - `getEffectiveUserId(sessionUserId: string | undefined): string | undefined`
- Persist `impersonatingId` in `sessionStorage` (key `major7s.shadow`) so a refresh keeps the simulation but a new tab/window does not.
- On `startImpersonation`: clears the per-user `major7s.activeTeamId` localStorage key so the impersonated user's primary team is picked fresh.
- `stopImpersonation`: clears storage, resets context state, invalidates queries `["teams"]`, `["profile"]`, `["picks"]`, `["roster-status"]`, `["missing-picks"]`.
- Guard: `startImpersonation` is a no-op unless `isAdminSession === true`.

### NEW · `src/components/impersonation-banner.tsx`
- Returns `null` when not impersonating.
- Otherwise a `fixed bottom-0 inset-x-0 z-50` bar, amber background (`bg-amber-500 text-amber-950`), with:
  - `⚠️ SHADOW MODE ACTIVE: Currently simulating {full name} (Team: {team_nickname})`
  - A right-aligned shadcn `Button` size="sm" variant="secondary" labeled `🛑 Stop Simulation` → calls `stopImpersonation()` then `router.navigate({ to: "/admin" })`.

### EDIT · `src/routes/__root.tsx`
- Wrap children with `<ImpersonationProvider>` *inside* `<AuthProvider>` and *outside* `<TeamsProvider>` (so teams sees the effective user).
- Mount `<ImpersonationBanner />` once near `<Outlet />` (after the auth layout, so it floats above everything).

### EDIT · `src/hooks/use-teams.tsx`
- Replace the line `const { user } = useAuth();` with `const { user } = useAuth(); const { getEffectiveUserId } = useImpersonation(); const effectiveId = getEffectiveUserId(user?.id);`
- Query becomes `.eq("owner_user_id", effectiveId)` with `queryKey: ["teams", effectiveId]` and `enabled: !!effectiveId`.
- localStorage key for active team becomes `major7s.activeTeamId:${effectiveId}` so admin's own selection isn't trampled.

### EDIT · `src/routes/_authenticated/profile.tsx`
- Pull `getEffectiveUserId` from impersonation context.
- Swap every `user!.id` / `user?.id` used for *profile reads/updates* to `effectiveId`. Keep `useAuth()` only for the auth gate (`if (!user) return …`).
- The password change UI must stay gated by the **real** session — disable the password block when `impersonatingId` is set (with a small notice "Password changes disabled in Shadow Mode"). Reason: `supabase.auth.updateUser({ password })` always targets the signed-in admin; we will not let an admin overwrite their own password by accident from this screen.

### EDIT · `src/routes/_authenticated/tournament.$id.tsx`
- Same pattern: derive `effectiveId`, use it for the `profile` query (L85) and any other `user.id` usage. `useTeams()` already returns the simulated user's team.

### EDIT · `src/routes/_authenticated/tournament.$id.lineup.tsx`
- `effectiveId` swap on the profile lookup at L70 (`.eq("id", effectiveId)`).
- `activeTeam!.id` in the picks insert/update keeps working because `useTeams` now resolves to the simulated user's team.
- No change to tweak math — `tweak_count = max(existing) + changed` already runs against `existingPicks` which is fetched by `activeTeam.id`, i.e. the simulated user's team.

### EDIT · `src/routes/_authenticated/admin.index.tsx`
- Import `useImpersonation` + `useNavigate` from `@tanstack/react-router`.
- Add a column "Actions" *(or append to existing)* in two places:
  1. **ApprovalsTab** table — alongside the Approve/Reject buttons, render a `Simulate` button. Available for any row regardless of status (admins may want to debug a pending account too).
  2. **SubmissionsTab** master grid — append a final `<TableHead></TableHead>` and a per-row cell with the same button, keyed off `r.ownerUserId`.
- Button content: `<EyeOff className="size-3.5" /> 🕵️ Simulate User` (Lucide `EyeOff` reads as "incognito").
- Handler:
  ```ts
  startImpersonation(targetId);
  toast.success(`Simulation initialized: Acting as ${displayName}`);
  navigate({ to: "/home" });
  ```
- CSV / KPI logic is untouched.

---

## What I am explicitly NOT doing

- No DB migration. Existing RLS already covers admin writes via `has_role`.
- No server-side function. All swaps are client-side query-target swaps; the admin's real Supabase session is what authenticates each request.
- No audit log table. Could be added later (recommend it before production), but out of scope for this turn.
- No realtime-broadcast or "kick out the real user" semantics — Shadow Mode is read/edit-as, not a session takeover.

## Security checklist baked into the implementation

- `startImpersonation` no-ops unless `isAdminSession === true`.
- Banner is a global UI signal that cannot be dismissed without ending the simulation.
- Profile password change is disabled in Shadow Mode to prevent self-pwn.
- `sessionStorage` (not localStorage) so closing the tab ends the simulation.
- Re-using existing RLS policies — no service-role keys ever touch the client.

## Open questions (answer if you want a different shape, otherwise I'll proceed as above)

1. Should ending the simulation drop the admin back at `/admin` (current plan) or at the user dashboard `/home` from where they were impersonating? Current plan: `/admin`.
2. Want me to also add the Simulate button on the Bulk Import tab? Currently no — that tab has no per-row UI.
