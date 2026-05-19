
-- Add suspended status
ALTER TYPE public.profile_status ADD VALUE IF NOT EXISTS 'suspended';

-- Extend profiles with new fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS referral_name TEXT,
  ADD COLUMN IF NOT EXISTS team_nickname TEXT;

-- New signups default to pending approval
ALTER TABLE public.profiles ALTER COLUMN status SET DEFAULT 'pending'::profile_status;

-- Update handle_new_user to capture metadata and default to pending
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  nick TEXT;
  fn TEXT;
  ln TEXT;
  ph TEXT;
  ref TEXT;
  team_nick TEXT;
BEGIN
  fn := NEW.raw_user_meta_data->>'first_name';
  ln := NEW.raw_user_meta_data->>'last_name';
  ph := NEW.raw_user_meta_data->>'phone';
  ref := NEW.raw_user_meta_data->>'referral_name';
  team_nick := NEW.raw_user_meta_data->>'team_nickname';
  nick := COALESCE(
    NEW.raw_user_meta_data->>'nickname',
    team_nick,
    NULLIF(TRIM(CONCAT_WS(' ', fn, ln)), ''),
    split_part(NEW.email, '@', 1),
    'Player'
  );
  INSERT INTO public.profiles (id, nickname, email, first_name, last_name, phone, referral_name, team_nickname, status)
  VALUES (NEW.id, nick, NEW.email, fn, ln, ph, ref, team_nick, 'pending');
  INSERT INTO public.teams (owner_user_id, nickname, is_primary)
  VALUES (NEW.id, COALESCE(team_nick, nick), true);
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$function$;
