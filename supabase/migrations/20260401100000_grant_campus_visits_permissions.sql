-- Fix: grant table-level permissions on campus_visits to authenticated role.
-- The RLS policy existed but PostgreSQL table grants were missing,
-- causing "permission denied for table campus_visits" errors.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campus_visits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campus_visits TO service_role;
