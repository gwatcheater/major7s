## Objective
Resolve the Supabase linter warning "Signed-In Users Can Execute SECURITY DEFINER Function" by revoking `EXECUTE` on trigger-only `SECURITY DEFINER` functions so they cannot be invoked through the PostgREST API.

## Approach
Trigger functions run with the table owner's privileges via the trigger itself — clients never need `EXECUTE` on them. Revoking `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` closes the RPC surface without affecting trigger behavior.

Functions that are intentionally callable (`has_role`, `log_impersonation`, `set_primary_team`, `audit_admin_pick_edit`) are left untouched — they either back RLS policies or self-gate with `has_role(auth.uid(),'admin')`.

## Migration
A single migration revokes `EXECUTE` on these trigger-only functions:
- `public.enforce_pick_lock()`
- `public.handle_new_user()`
- `public.audit_teams()`
- `public.audit_profile_status()`
- `public.audit_user_roles()`
- `public.protect_profile_status()`
- `public.set_updated_at()`

For each:
```sql
REVOKE EXECUTE ON FUNCTION public.<fn>() FROM PUBLIC, anon, authenticated;
```

## Verification
- Re-run the Supabase linter; the warning should clear for the revoked functions.
- Triggers continue firing on inserts/updates/deletes (trigger execution does not require caller `EXECUTE`).
- App behavior (auth signup, pick edits, audit logging, profile status protection) is unchanged.