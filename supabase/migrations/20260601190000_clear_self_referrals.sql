-- Clear referral_name where it matches the user's own nickname
-- or their primary team nickname (case-insensitive).
UPDATE public.profiles p
SET referral_name = NULL
WHERE referral_name IS NOT NULL
  AND (
    LOWER(TRIM(p.referral_name)) = LOWER(TRIM(p.nickname))
    OR EXISTS (
      SELECT 1
      FROM public.teams t
      WHERE t.owner_user_id = p.id
        AND t.is_primary = true
        AND LOWER(TRIM(t.nickname)) = LOWER(TRIM(p.referral_name))
    )
  );
