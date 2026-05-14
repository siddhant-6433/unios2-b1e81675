-- Public RPC for the apply-portal "I have an application ID" anonymous lookup.
--
-- Without this, the apply portal needs anon SELECT on public.applications to
-- find the phone for OTP routing — which means *every* anon can dump the
-- entire applications table. This RPC returns only the minimal info needed
-- (phone, full_name) for a single application_id and is the supported anon
-- read path. Direct anon SELECT on applications can then be removed.

CREATE OR REPLACE FUNCTION public.lookup_application_for_otp(p_application_id text)
RETURNS TABLE (phone text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT a.phone, a.full_name
  FROM public.applications a
  WHERE a.application_id = upper(trim(p_application_id))
  UNION ALL
  SELECT l.phone, l.name AS full_name
  FROM public.leads l
  WHERE l.application_id = upper(trim(p_application_id))
    AND NOT EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.application_id = upper(trim(p_application_id))
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_application_for_otp(text) TO anon, authenticated;
