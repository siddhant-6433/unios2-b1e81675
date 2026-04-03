-- Fix: grant table access to authenticated role on consultants
-- The table had RLS policies but no base GRANT, so nobody could access it.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultants TO authenticated;
