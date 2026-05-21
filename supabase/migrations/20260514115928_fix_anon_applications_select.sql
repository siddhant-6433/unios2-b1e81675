-- Fix: apply portal cannot load existing applications after another workspace's
-- "tighten_applications_rls" migration (20260513172727) removed the broad
-- "Anyone can view applications FOR SELECT TO anon" policy.
--
-- The portal authenticates applicants via WhatsApp OTP (custom, not Supabase
-- auth), so it always uses the anon role. Restoring a bare anon SELECT policy
-- would re-open the whole table. Instead, use a SECURITY DEFINER function so
-- the table stays locked to authenticated users but the portal can still read
-- applications scoped to the verified phone number.

CREATE OR REPLACE FUNCTION public.get_applicant_applications_by_phone(_phone text)
RETURNS SETOF public.applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _phone IS NULL OR _phone = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT *
  FROM public.applications
  WHERE phone = _phone
  ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_applications_by_phone(text) TO anon, authenticated;
