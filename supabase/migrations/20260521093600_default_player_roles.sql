-- Ensure every existing user has the 'user' (Player) role.
-- Skip users who already have it (ON CONFLICT … DO NOTHING).
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::public.app_role
  FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- Remove 'admin' role from everyone except rob@rjparker.co.uk.
DELETE FROM public.user_roles
 WHERE role = 'admin'
   AND user_id NOT IN (
     SELECT id FROM auth.users WHERE email = 'rob@rjparker.co.uk'
   );
