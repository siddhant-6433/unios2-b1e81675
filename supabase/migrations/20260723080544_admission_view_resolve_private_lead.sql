-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260723080544 name=admission_view_resolve_private_lead applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.get_application_lead(_application_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lead_id uuid;
  v_result jsonb;
BEGIN
  -- Only admission-processing staff. Counsellors are intentionally excluded to
  -- preserve partner-lead privacy in the counsellor pool.
  IF v_uid IS NULL OR NOT (
       public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'principal'::app_role)
    OR public.has_role(v_uid, 'admission_head'::app_role)
    OR public.has_role(v_uid, 'campus_admin'::app_role)
    OR public.has_role(v_uid, 'data_entry'::app_role)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT lead_id INTO v_lead_id
  FROM public.applications
  WHERE application_id = _application_id;

  IF v_lead_id IS NULL THEN
    RETURN NULL;  -- orphan application: genuinely no linked lead
  END IF;

  SELECT to_jsonb(x) INTO v_result
  FROM (
    SELECT
      l.id, l.name, l.phone, l.course_id, l.campus_id,
      l.pre_admission_no, l.admission_no, l.consultant_id, l.academic_partner_id,
      CASE WHEN con.id IS NULL THEN NULL
           ELSE jsonb_build_object('name', con.name) END AS lead_consultant,
      CASE WHEN c.id IS NULL THEN NULL
           ELSE jsonb_build_object(
             'name', c.name, 'code', c.code, 'duration_years', c.duration_years,
             'eligibility', c.eligibility, 'entrance_exam', c.entrance_exam,
             'entrance_mandatory', c.entrance_mandatory) END AS course
    FROM public.leads l
    LEFT JOIN public.consultants con ON con.id = l.consultant_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = v_lead_id
  ) x;

  RETURN v_result;  -- NULL only if the lead row truly no longer exists
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_application_lead(text) TO authenticated;
