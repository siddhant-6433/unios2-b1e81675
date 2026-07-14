-- Expose lead phone/email to applicant-facing TokenFeePanel so payment CTAs
-- still work when the login profile has no phone (common after email login
-- or when application.phone differs from profiles.phone).

DROP FUNCTION IF EXISTS public.get_applicant_lead_info(uuid);

CREATE OR REPLACE FUNCTION public.get_applicant_lead_info(_lead_id uuid)
RETURNS TABLE(
  id uuid,
  stage text,
  session_id uuid,
  pre_admission_no text,
  admission_no text,
  phone text,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.stage::text,
    l.session_id,
    l.pre_admission_no,
    l.admission_no,
    l.phone,
    l.email
  FROM public.leads l
  WHERE l.id = _lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_lead_info(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.get_applicant_lead_info(uuid) IS
  'Applicant-safe lead fields for TokenFeePanel (includes phone/email for gateway prefill).';
