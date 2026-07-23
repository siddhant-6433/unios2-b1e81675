-- Fix: admission staff (principal / admission_head / campus_admin) see a false
-- "Lead has been deleted" banner on applications whose lead is an academic-partner
-- PRIVATE lead (shared_with_nimt = false), and cannot issue offers / approve / etc.
--
-- Root cause: the "Staff can view leads" RLS policy hides private partner leads
-- from every NIMT role except super_admin. AdminApplicationView reads the lead
-- with a direct RLS-bound SELECT; it comes back null, so the UI treats the lead
-- as deleted (and worse, "issue offer" would create a DUPLICATE lead, severing
-- the partner linkage).
--
-- The WRITE side already allows these roles (Staff can update leads / Staff can
-- insert offers have no shared_with_nimt gate). Only the SELECT is blocked. So we
-- resolve the lead for the admission view via a role-gated SECURITY DEFINER RPC
-- rather than loosening the hot, perf-sensitive leads SELECT policy globally
-- (which would also re-expose private leads in lists/pools). Scope stays limited
-- to processing an application that already exists in the pipeline.

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
