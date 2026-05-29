-- Add ESPN event id to tournaments
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS espn_event_id text;

-- Leaderboard table
CREATE TABLE public.tournament_leaderboard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  golfer_id uuid REFERENCES public.golfers(id) ON DELETE SET NULL,
  espn_player_id text NOT NULL,
  espn_display_name text NOT NULL,
  country text,
  position_display text,
  position_numeric integer,
  is_tie boolean,
  status_type text,
  total_strokes integer,
  score_to_par integer,
  round_1 integer,
  round_2 integer,
  round_3 integer,
  round_4 integer,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, espn_player_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_leaderboard TO authenticated;
GRANT ALL ON public.tournament_leaderboard TO service_role;

ALTER TABLE public.tournament_leaderboard ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leaderboard: signed-in read"
ON public.tournament_leaderboard
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Leaderboard: admin insert"
ON public.tournament_leaderboard
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Leaderboard: admin update"
ON public.tournament_leaderboard
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Leaderboard: admin delete"
ON public.tournament_leaderboard
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX idx_tournament_leaderboard_tournament ON public.tournament_leaderboard(tournament_id);
