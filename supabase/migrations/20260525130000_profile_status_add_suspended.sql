-- Re-introduce 'suspended' as distinct from 'rejected'.
--   rejected  = declined at sign-up (never approved)
--   suspended = previously-active account that has been disabled
--
-- No backfill: historical 'rejected' rows are left untouched. The two states were
-- previously conflated, so existing rows cannot be reliably separated retroactively.
-- Going forward the admin "Reject" action writes 'rejected' and "Suspend" writes 'suspended'.
--
-- NOTE: ADD VALUE must commit before the new value can be USED. This migration only
-- adds the value (no rows are updated here), so it is safe in a single transaction.

ALTER TYPE public.profile_status ADD VALUE IF NOT EXISTS 'suspended';
