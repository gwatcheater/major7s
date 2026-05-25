-- Phase 1: guarantee at most one primary team per owner.
-- Cleans up any pre-existing violations, then enforces with a partial unique index.

-- 1) Demote duplicate primaries: keep the earliest-created primary per owner.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY owner_user_id
           ORDER BY created_at, id
         ) AS rn
  FROM public.teams
  WHERE is_primary
)
UPDATE public.teams t
SET is_primary = false
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

-- 2) Promote a primary for owners who have teams but none flagged primary.
WITH need AS (
  SELECT owner_user_id
  FROM public.teams
  GROUP BY owner_user_id
  HAVING bool_or(is_primary) = false
),
pick AS (
  SELECT DISTINCT ON (t.owner_user_id) t.id
  FROM public.teams t
  JOIN need n ON n.owner_user_id = t.owner_user_id
  ORDER BY t.owner_user_id, t.created_at, t.id
)
UPDATE public.teams t
SET is_primary = true
FROM pick p
WHERE t.id = p.id;

-- 3) Enforce: at most one primary team per owner.
CREATE UNIQUE INDEX IF NOT EXISTS teams_one_primary_per_owner
  ON public.teams (owner_user_id)
  WHERE is_primary;
