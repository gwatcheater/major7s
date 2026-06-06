## Findings

The button code and imports in `src/routes/_authenticated/tournament.$id.tsx` are correct. The button is gated on `isAdmin` from `useAuth()`. Your current preview route is `/login?redirect=%2Fhome`, which strongly suggests you are not authenticated as admin in this preview tab.

`isAdmin` resolves to `true` only if your user has a row in `user_roles` with `role = 'admin'`. The check is async (deferred via setTimeout in `use-auth.tsx`), and starts as `false`.

## Diagnostic steps (build mode)

1. **Add temporary debug logging** to `src/routes/_authenticated/tournament.$id.tsx`:
   - Log `{ userId: user?.id, isAdmin }` on every render so we can see the actual values in the console.
   - Render a small visible debug chip near the Blog section showing `admin: {String(isAdmin)}` and `user: {user?.email ?? "none"}` — only when not in production.

2. **Add a dev-mode fallback** so we can distinguish "JSX never renders" from "isAdmin is false":
   ```tsx
   {isAdmin ? (
     <Button asChild ...>...</Button>
   ) : import.meta.env.DEV ? (
     <div className="p-4 text-xs text-muted-foreground border-b border-border">
       [dev only] Admin button hidden — isAdmin = {String(isAdmin)}
     </div>
   ) : null}
   ```
   Note: in Vite use `import.meta.env.DEV`, not `process.env.NODE_ENV` (which is undefined in the browser bundle).

3. **Verify admin role in the database** via `read_query`:
   ```sql
   SELECT ur.user_id, u.email, ur.role
   FROM public.user_roles ur
   JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.role = 'admin';
   ```
   Confirm the signed-in account appears.

4. **After diagnosis**, remove the debug logging and dev-only fallback, leaving only the original `{isAdmin && ...}` button.

## What I will NOT do

- Will not change the gating to render for non-admins in production.
- Will not touch RLS, schemas, or the general `/blog` page.
- Will not modify `use-auth.tsx` unless step 3 proves the role check itself is broken.

## Expected outcome

One of these three:
- Console shows `isAdmin: true` → button is actually rendering; issue is visual (collapsible closed, scroll, cache). Hard reload.
- Console shows `isAdmin: false` but DB has admin row → auth/session issue; need to sign in or `use-auth.tsx` query is failing.
- DB has no admin row for your user → need to insert one.
