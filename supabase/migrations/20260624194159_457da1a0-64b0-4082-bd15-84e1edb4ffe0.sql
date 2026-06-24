CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_admin_on_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://www.major7s.com/api/public/hooks/new-user-signup',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('email', NEW.email)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'notify_admin_on_new_profile failed for %: %', NEW.email, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_on_new_profile ON public.profiles;
CREATE TRIGGER trg_notify_admin_on_new_profile
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_on_new_profile();