ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
CREATE INDEX IF NOT EXISTS profiles_last_seen_at_desc_idx ON public.profiles (last_seen_at DESC NULLS LAST);
UPDATE public.profiles p SET last_seen_at = u.last_sign_in_at FROM auth.users u WHERE u.id = p.id AND p.last_seen_at IS NULL;