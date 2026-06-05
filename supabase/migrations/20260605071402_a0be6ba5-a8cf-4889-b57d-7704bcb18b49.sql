-- Lock down SECURITY DEFINER functions: revoke broad EXECUTE from PUBLIC/anon/authenticated
-- for trigger-only functions, and keep explicit grants only where signed-in users must call them.

-- Trigger-only functions (never called directly from client)
REVOKE EXECUTE ON FUNCTION public.enforce_pick_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_teams() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_profile_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_user_roles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_status() FROM PUBLIC, anon, authenticated;

-- has_role is used inside RLS policies; keep EXECUTE for authenticated only.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Admin-callable RPCs (internal admin check via has_role) — authenticated only, no anon.
REVOKE EXECUTE ON FUNCTION public.set_primary_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_primary_team(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.log_impersonation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_impersonation(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.audit_admin_pick_edit(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_admin_pick_edit(uuid, uuid, boolean) TO authenticated;