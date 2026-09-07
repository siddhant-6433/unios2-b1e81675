-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260902152852 name=fee_term_label_rpcs_include_course applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP FUNCTION IF EXISTS public.get_applicant_lead_info(uuid);

CREATE OR REPLACE FUNCTION public.get_applicant_lead_info(_lead_id uuid)
RETURNS TABLE(
  id uuid,
  stage text,
  session_id uuid,
  pre_admission_no text,
  admission_no text,
  phone text,
  email text,
  course_id uuid
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
    l.email,
    l.course_id
  FROM public.leads l
  WHERE l.id = _lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_lead_info(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.get_applicant_lead_info(uuid) IS
  'Applicant-safe lead fields for TokenFeePanel (phone/email for gateway prefill, course_id to resolve fee-structure period labels).';
