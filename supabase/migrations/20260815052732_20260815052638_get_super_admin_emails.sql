-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260815052732 name=20260815052638_get_super_admin_emails applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.get_super_admin_emails()
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.email
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.role = 'super_admin'
    AND u.email IS NOT NULL
  ORDER BY u.email;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_emails() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_super_admin_emails() TO service_role;
