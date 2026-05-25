-- Atomically change which team is primary for an owner.
-- Demotes the current primary and promotes the chosen team in one statement,
-- so the partial unique index teams_one_primary_per_owner is never transiently violated.
-- Admin-only; the function re-checks the role server-side.

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

  -- Single statement flips exactly one owner's primary flag:
  -- the target becomes primary, every other team of that owner becomes non-primary.
  UPDATE public.teams
  SET is_primary = (id = _team_id)
  WHERE owner_user_id = _owner;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_primary_team(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_primary_team(UUID) TO authenticated;
