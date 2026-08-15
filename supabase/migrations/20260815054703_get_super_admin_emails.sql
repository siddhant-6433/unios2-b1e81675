-- Resolve current super_admin email addresses for system alerts (e.g. the
-- Meta lead-ingestion silence watchdog). SECURITY DEFINER so edge functions can
-- read auth.users without exposing the whole table. Dynamic, so the recipient
-- list stays correct as admins change instead of being hardcoded in an env var.
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
