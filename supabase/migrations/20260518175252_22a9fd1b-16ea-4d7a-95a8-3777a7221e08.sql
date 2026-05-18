ALTER TABLE public.tournaments
ADD COLUMN bucket_sizes jsonb NOT NULL DEFAULT '{"1":10,"2":10,"3":10,"4":10,"5":0,"6":0,"7":0}'::jsonb;