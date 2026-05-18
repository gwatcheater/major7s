
-- =========================================
-- ENUMS
-- =========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.tournament_status AS ENUM ('upcoming', 'open', 'locked', 'live', 'completed');
CREATE TYPE public.profile_status AS ENUM ('pending', 'approved');

-- =========================================
-- PROFILES (parent account)
-- =========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  email TEXT,
  status public.profile_status NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =========================================
-- USER ROLES (separate table — never on profile)
-- =========================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

-- =========================================
-- TEAMS (game profiles, multi-team per user)
-- =========================================
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX teams_owner_idx ON public.teams(owner_user_id);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- =========================================
-- TOURNAMENTS
-- =========================================
CREATE TABLE public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  course TEXT NOT NULL,
  logo_url TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  lock_at TIMESTAMPTZ NOT NULL,
  status public.tournament_status NOT NULL DEFAULT 'upcoming',
  recap_blog TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

-- =========================================
-- GOLFERS (normalized master)
-- =========================================
CREATE TABLE public.golfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_name TEXT NOT NULL UNIQUE,
  owgr_rank INTEGER,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX golfers_rank_idx ON public.golfers(owgr_rank);
ALTER TABLE public.golfers ENABLE ROW LEVEL SECURITY;

-- =========================================
-- TOURNAMENT FIELD (golfer pool per tournament)
-- =========================================
CREATE TABLE public.tournament_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  golfer_id UUID NOT NULL REFERENCES public.golfers(id) ON DELETE CASCADE,
  owgr_bucket SMALLINT NOT NULL CHECK (owgr_bucket BETWEEN 1 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, golfer_id)
);
CREATE INDEX tournament_field_tid_idx ON public.tournament_field(tournament_id);
ALTER TABLE public.tournament_field ENABLE ROW LEVEL SECURITY;

-- =========================================
-- PICKS (team selections per tournament)
-- =========================================
CREATE TABLE public.picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  bucket SMALLINT NOT NULL CHECK (bucket BETWEEN 1 AND 7),
  golfer_id UUID NOT NULL REFERENCES public.golfers(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tweak_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tournament_id, team_id, bucket)
);
CREATE INDEX picks_tid_idx ON public.picks(tournament_id);
CREATE INDEX picks_team_idx ON public.picks(team_id);
ALTER TABLE public.picks ENABLE ROW LEVEL SECURITY;

-- =========================================
-- updated_at trigger helper
-- =========================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tournaments_updated BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_golfers_updated BEFORE UPDATE ON public.golfers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Auto-create profile + primary team on signup
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nick TEXT;
BEGIN
  nick := COALESCE(
    NEW.raw_user_meta_data->>'nickname',
    split_part(NEW.email, '@', 1),
    'Player'
  );
  INSERT INTO public.profiles (id, nickname, email)
  VALUES (NEW.id, nick, NEW.email);
  INSERT INTO public.teams (owner_user_id, nickname, is_primary)
  VALUES (NEW.id, nick, true);
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- LOCK-CLOCK ENFORCEMENT (server-evaluated)
-- =========================================
CREATE OR REPLACE FUNCTION public.enforce_pick_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t_lock TIMESTAMPTZ;
  is_admin BOOLEAN;
BEGIN
  -- Admin always bypasses
  is_admin := public.has_role(auth.uid(), 'admin');
  IF is_admin THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT lock_at INTO t_lock FROM public.tournaments
   WHERE id = COALESCE(NEW.tournament_id, OLD.tournament_id);

  IF t_lock IS NOT NULL AND now() >= t_lock THEN
    RAISE EXCEPTION 'Picks are locked for this tournament';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_picks_lock_insert BEFORE INSERT ON public.picks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pick_lock();
CREATE TRIGGER trg_picks_lock_update BEFORE UPDATE ON public.picks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pick_lock();
CREATE TRIGGER trg_picks_lock_delete BEFORE DELETE ON public.picks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pick_lock();

-- =========================================
-- RLS POLICIES
-- =========================================

-- profiles
CREATE POLICY "Profiles: anyone signed in can read"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Profiles: user can update own"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Profiles: admins can update any"
  ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Profiles: admins can delete"
  ON public.profiles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- user_roles
CREATE POLICY "Roles: user can read own"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Roles: admins manage"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- teams
CREATE POLICY "Teams: signed-in can read all"
  ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Teams: owner inserts own"
  ON public.teams FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Teams: owner updates own"
  ON public.teams FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Teams: owner deletes own"
  ON public.teams FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- tournaments
CREATE POLICY "Tournaments: signed-in read"
  ON public.tournaments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tournaments: admin write"
  ON public.tournaments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- golfers
CREATE POLICY "Golfers: signed-in read"
  ON public.golfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Golfers: admin write"
  ON public.golfers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- tournament_field
CREATE POLICY "Field: signed-in read"
  ON public.tournament_field FOR SELECT TO authenticated USING (true);
CREATE POLICY "Field: admin write"
  ON public.tournament_field FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- picks
CREATE POLICY "Picks: signed-in read all"
  ON public.picks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Picks: team owner inserts"
  ON public.picks FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND (t.owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );
CREATE POLICY "Picks: team owner updates"
  ON public.picks FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND (t.owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );
CREATE POLICY "Picks: team owner deletes"
  ON public.picks FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND (t.owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );
