-- Wipe existing data (keep profiles/user_roles/auth intact)
TRUNCATE public.picks, public.tournament_field, public.golfers, public.tournaments, public.teams RESTART IDENTITY CASCADE;

-- Drop the now-unused field join table
DROP TABLE IF EXISTS public.tournament_field CASCADE;

-- profile_status: pending/approved/rejected
ALTER TYPE public.profile_status RENAME TO profile_status_old;
CREATE TYPE public.profile_status AS ENUM ('pending', 'approved', 'rejected');
ALTER TABLE public.profiles
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.profile_status USING (
    CASE status::text
      WHEN 'suspended' THEN 'rejected'
      ELSE status::text
    END::public.profile_status
  ),
  ALTER COLUMN status SET DEFAULT 'pending'::public.profile_status;
DROP TYPE public.profile_status_old;

-- Unique team_nickname on profiles (globally unique)
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_team_nickname_unique UNIQUE (team_nickname);

-- Unique team name per owner on teams
ALTER TABLE public.teams
  ADD CONSTRAINT teams_owner_nickname_unique UNIQUE (owner_user_id, nickname);

-- Tournaments: rename + new status enum
ALTER TABLE public.tournaments RENAME COLUMN course TO location;
ALTER TABLE public.tournaments RENAME COLUMN lock_at TO submission_deadline;

ALTER TYPE public.tournament_status RENAME TO tournament_status_old;
CREATE TYPE public.tournament_status AS ENUM ('upcoming', 'open_for_picks', 'picks_closed', 'live', 'completed');
ALTER TABLE public.tournaments
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.tournament_status USING (
    CASE status::text
      WHEN 'open' THEN 'open_for_picks'
      WHEN 'locked' THEN 'picks_closed'
      ELSE status::text
    END::public.tournament_status
  ),
  ALTER COLUMN status SET DEFAULT 'upcoming'::public.tournament_status;
DROP TYPE public.tournament_status_old;

-- Golfers: per-tournament with bucket number
ALTER TABLE public.golfers RENAME COLUMN standard_name TO golfer_name;
ALTER TABLE public.golfers DROP COLUMN IF EXISTS aliases;
ALTER TABLE public.golfers ADD COLUMN tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.golfers ADD COLUMN bucket_number smallint NOT NULL CHECK (bucket_number BETWEEN 1 AND 7);
CREATE INDEX idx_golfers_tournament ON public.golfers(tournament_id);
CREATE INDEX idx_golfers_tournament_bucket ON public.golfers(tournament_id, bucket_number);

-- Update pick-lock trigger to use new column name
CREATE OR REPLACE FUNCTION public.enforce_pick_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t_lock TIMESTAMPTZ;
  is_admin BOOLEAN;
BEGIN
  is_admin := public.has_role(auth.uid(), 'admin');
  IF is_admin THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT submission_deadline INTO t_lock FROM public.tournaments
   WHERE id = COALESCE(NEW.tournament_id, OLD.tournament_id);
  IF t_lock IS NOT NULL AND now() >= t_lock THEN
    RAISE EXCEPTION 'Picks are locked for this tournament';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;