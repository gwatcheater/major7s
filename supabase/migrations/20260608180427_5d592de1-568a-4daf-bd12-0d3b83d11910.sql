ALTER TABLE public.picks_helper ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.picks_helper FROM anon;
GRANT SELECT ON public.picks_helper TO authenticated;
GRANT ALL ON public.picks_helper TO service_role;
CREATE POLICY "Authenticated users can read picks_helper"
  ON public.picks_helper FOR SELECT TO authenticated USING (true);