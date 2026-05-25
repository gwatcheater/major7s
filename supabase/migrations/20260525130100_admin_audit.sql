-- =========================================================
-- admin_audit: tamper-resistant log of privileged changes.
-- Written by SECURITY DEFINER triggers so the actor (auth.uid())
-- is captured server-side regardless of the client path used.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.admin_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID,                       -- auth.uid() of whoever made the change (null if system/trigger w/o session)
  action      TEXT NOT NULL,              -- e.g. 'profile.status', 'role.grant', 'role.revoke', 'team.insert'
  target_user UUID,                        -- the user the change concerns
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON public.admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx  ON public.admin_audit (target_user);

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

-- Admins may read the log. No INSERT/UPDATE/DELETE policy exists, so the table is
-- append-only from clients (writes happen only via SECURITY DEFINER triggers, which
-- bypass RLS). This makes the log tamper-resistant: even an admin cannot edit history.
DROP POLICY IF EXISTS "Audit: admins read" ON public.admin_audit;
CREATE POLICY "Audit: admins read"
  ON public.admin_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Keep clients off the table entirely except through RLS-governed SELECT.
REVOKE INSERT, UPDATE, DELETE ON public.admin_audit FROM PUBLIC, anon, authenticated;

-- ---------- profile status changes ----------
CREATE OR REPLACE FUNCTION public.audit_profile_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
    VALUES (
      auth.uid(), 'profile.status', NEW.id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_profile_status ON public.profiles;
CREATE TRIGGER trg_audit_profile_status
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_profile_status();

-- ---------- role grants / revokes ----------
CREATE OR REPLACE FUNCTION public.audit_user_roles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
    VALUES (auth.uid(), 'role.grant', NEW.user_id, jsonb_build_object('role', NEW.role));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
    VALUES (auth.uid(), 'role.revoke', OLD.user_id, jsonb_build_object('role', OLD.role));
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles();

-- ---------- team create / delete / rename ----------
CREATE OR REPLACE FUNCTION public.audit_teams()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
    VALUES (auth.uid(), 'team.insert', NEW.owner_user_id,
            jsonb_build_object('team_id', NEW.id, 'nickname', NEW.nickname, 'is_primary', NEW.is_primary));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
    VALUES (auth.uid(), 'team.delete', OLD.owner_user_id,
            jsonb_build_object('team_id', OLD.id, 'nickname', OLD.nickname));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND NEW.nickname IS DISTINCT FROM OLD.nickname THEN
    INSERT INTO public.admin_audit (actor_id, action, target_user, detail)
    VALUES (auth.uid(), 'team.rename', NEW.owner_user_id,
            jsonb_build_object('team_id', NEW.id, 'from', OLD.nickname, 'to', NEW.nickname));
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_audit_teams ON public.teams;
CREATE TRIGGER trg_audit_teams
  AFTER INSERT OR UPDATE OR DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.audit_teams();

-- Lock down EXECUTE on the new SECURITY DEFINER functions (consistent with existing ones).
REVOKE EXECUTE ON FUNCTION public.audit_profile_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_user_roles()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_teams()         FROM PUBLIC, anon, authenticated;
