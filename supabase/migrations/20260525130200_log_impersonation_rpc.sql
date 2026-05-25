-- Admin-only RPC for logging impersonation (shadow mode) start/stop.
-- Shadow sessions are read-only and change no rows, so the table triggers can't
-- observe them. This SECURITY DEFINER function lets an admin append a single
-- audit row; the function itself enforces that only admins may call it, so the
-- audit table stays locked to direct client writes.

CREATE OR REPLACE FUNCTION public.log_impersonation(_target UUID, _event TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins may log; reject anything else.
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can log impersonation';
  END IF;

  -- Constrain the event values to the two we expect.
  IF _event NOT IN ('impersonation.start', 'impersonation.stop') THEN
    RAISE EXCEPTION 'Invalid impersonation event: %', _event;
  END IF;

  INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
  VALUES (auth.uid(), _event, _target, '{}'::jsonb);
END;
$$;

-- Lock down EXECUTE, then grant only to authenticated (the function body still
-- re-checks admin via has_role, so non-admins calling it will be rejected).
REVOKE EXECUTE ON FUNCTION public.log_impersonation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_impersonation(UUID, TEXT) TO authenticated;
