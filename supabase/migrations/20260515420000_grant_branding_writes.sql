-- Authenticated needs table-level INSERT/UPDATE/DELETE for the
-- "Super admin manages branding" RLS policy to actually allow writes.
-- Without these grants Postgres blocks the request before RLS runs.
GRANT INSERT, UPDATE, DELETE ON public.institution_branding TO authenticated;
