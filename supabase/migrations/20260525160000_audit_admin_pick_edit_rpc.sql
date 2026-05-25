-- Admin-only RPC to log when an admin saves picks while simulating a user
-- (shadow mode). The pick rows themselves are written under the admin session
-- and carry no admin marker, so this audit row is the record of the override.

CREATE OR REPLACE FUNCTION public.audit_admin_pick_edit(
  _target UUID,
  _tournament UUID,
  _after_lock BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can log admin pick edits';
  END IF;

  INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
  VALUES (
    auth.uid(),
    'picks.admin_edit',
    _target,
    jsonb_build_object('tournament_id', _tournament, 'after_lock', _after_lock)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_admin_pick_edit(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_admin_pick_edit(UUID, UUID, BOOLEAN) TO authenticated;
