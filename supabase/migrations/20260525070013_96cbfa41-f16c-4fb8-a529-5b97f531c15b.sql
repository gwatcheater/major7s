
-- 1) Prevent users from self-approving by changing their own profile status
CREATE OR REPLACE FUNCTION public.protect_profile_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only admins can change account status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_status ON public.profiles;
CREATE TRIGGER trg_protect_profile_status
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_status();

-- 2) Restrict profile reads to the owner or admins (was: any authenticated)
DROP POLICY IF EXISTS "Profiles: anyone signed in can read" ON public.profiles;
CREATE POLICY "Profiles: owner or admin can read"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
