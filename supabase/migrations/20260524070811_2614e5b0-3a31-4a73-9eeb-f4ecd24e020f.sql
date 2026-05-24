ALTER TABLE public.golfers DROP CONSTRAINT IF EXISTS golfers_standard_name_key;
ALTER TABLE public.golfers ADD CONSTRAINT golfers_tournament_golfer_name_key UNIQUE (tournament_id, golfer_name);