## Plan: accurate "last seen" via `profiles.last_seen_at`

### 1. Migration (Supabase)

Add a nullable timestamp column + permissive update policy so any signed-in user can stamp their own row.

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_last_seen_at_desc_idx
  ON public.profiles (last_seen_at DESC NULLS LAST);

-- Backfill once so existing users aren't all blank on first load.
-- Use auth.users.last_sign_in_at as the starting point.
UPDATE public.profiles p
  SET last_seen_at = u.last_sign_in_at
  FROM auth.users u
  WHERE u.id = p.id AND p.last_seen_at IS NULL;
```

(`profiles` already has an update-own policy from earlier work; no new policy needed. If the linter flags otherwise after the migration I'll add a scoped `UPDATE` policy on `last_seen_at` only.)

### 2. App trigger — stamp on every authenticated mount

Add a tiny `LastSeenTracker` component inside `RootComponent` in `src/routes/__root.tsx`, rendered next to `AuthBridge`. It:

- Reads `useAuth()`.
- On `user.id` change (i.e. real sign-in / session restore on mount), fires once:
  ```ts
  supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
  ```
- Fire-and-forget, ignores errors (no UX impact). No throttling needed beyond "once per session/user change"; this satisfies the "persistent session returns" gap the user described.

### 3. Data source swap

In `src/lib/admin-users.functions.ts` → `listUsersForAdmin`:

- Add `last_seen_at` to the profile `select(...)` list.
- Extend `DirectoryRow` with `last_seen_at: string | null`.
- Keep `last_sign_in_at` populated from the Auth admin pagination as today (no behavior regression for other consumers).

In `src/components/admin/users-directory-tab.tsx`:

- Every render/sort that currently reads `u.last_sign_in_at` for the "Last seen" column or `engagementOf(...)` switches to `u.last_seen_at`. This covers:
  - `lastSeenLabel(u.last_seen_at)` (desktop cell + mobile card)
  - `engagementOf(u.last_seen_at)` (engagement dot + filter + counters)
  - `lastSeen` sort branch numeric comparison
- Formatting function `lastSeenLabel` is unchanged — same `YYYY-MM-DD HH:mm (ZONE)` output.
- CSV export switches its "Last seen" column to `last_seen_at` for consistency.

### 4. Default sort

Change initial state:

```ts
const [sortKey, setSortKey] = useState<SortKey>("lastSeen");
const [sortDir, setSortDir] = useState<1 | -1>(-1); // DESC, most recent first
```

Null `last_seen_at` already sorts to the bottom in DESC (existing branch uses `-Infinity`).

### Out of scope

- No changes to auth flow, RLS model, or other consumers of `last_sign_in_at`.
- No throttling table or RPC — a single update per mount is cheap and matches the user's spec ("on mount, if authenticated, update").
