-- Fix: make demotion happen before promotion explicitly, so the partial unique
-- index teams_one_primary_per_owner is never transiently violated mid-statement.
-- (A single UPDATE flipping the flag across rows can momentarily have two primaries
--  depending on row-rewrite order; two ordered statements avoid that entirely.)

CREATE OR REPLACE FUNCTION public.set_primary_team(_team_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change the primary team';
  END IF;

  SELECT owner_user_id INTO _owner FROM public.teams WHERE id = _team_id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  -- 1) Demote every currently-primary team for this owner.
  UPDATE public.teams
  SET is_primary = false
  WHERE owner_user_id = _owner AND is_primary;

  -- 2) Promote the target.
  UPDATE public.teams
  SET is_primary = true
  WHERE id = _team_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_primary_team(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_primary_team(UUID) TO authenticated;
