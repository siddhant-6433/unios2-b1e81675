-- Fix: exam_registrations table was missing GRANT for the `authenticated` role.
-- RLS policies existed but were never reached because PostgREST (running as
-- `authenticated`) lacked the underlying table privilege — all REST reads
-- returned zero rows, causing every badge to show "Unknown".
-- The SECURITY DEFINER RPCs (exam_set_status, exam_mark_registered) worked
-- because they run as `postgres`, masking the missing grant.

GRANT SELECT, INSERT, UPDATE ON public.exam_registrations TO authenticated;
