-- Keep AI-rejected and terminal leads out of the counsellor pickup bucket.
--
-- BUG: get_unassigned_leads_bucket() currently filters only
--   stage NOT IN ('admitted', 'rejected')
-- so leads that the WhatsApp classifier marked `not_interested` (because
-- the sender is a job applicant) and leads marked `dnc` / `ineligible`
-- still surface in the unassigned bucket. Counsellors pick them up,
-- spend a slot on them, and discover after the fact that the lead is
-- dead. Worse: when an admin bulk-reassigns one of these to a
-- counsellor, the WhatsApp "new lead assigned" notification fires but
-- the counsellor's dashboard hides the row (the dashboard filters
-- stage='new_lead'), so the counsellor sees a notification with no
-- corresponding lead to call.
--
-- FIX: exclude every terminal stage from the bucket. `deferred` is
-- intentionally kept visible — that's a counsellor-set "next intake"
-- park and admins do still want to redistribute those.

CREATE OR REPLACE FUNCTION public.get_unassigned_leads_bucket()
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  email text,
  stage text,
  source text,
  course_id uuid,
  campus_id uuid,
  created_at timestamptz,
  lead_score integer,
  lead_temperature text,
  course_name text,
  campus_name text,
  bucket text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.phone,
    l.email,
    l.stage::text,
    l.source::text,
    l.course_id,
    l.campus_id,
    l.created_at,
    l.lead_score,
    l.lead_temperature,
    c.name   AS course_name,
    cam.name AS campus_name,
    CASE
      WHEN i.type IS NOT NULL          THEN i.type
      WHEN cam_inst.type = 'school'    THEN 'school'
      WHEN jdm.is_school = true        THEN 'school'
      ELSE 'college'
    END AS bucket
  FROM public.leads l
  LEFT JOIN public.courses c            ON c.id = l.course_id
  LEFT JOIN public.departments d        ON d.id = c.department_id
  LEFT JOIN public.institutions i       ON i.id = d.institution_id
  LEFT JOIN public.campuses cam         ON cam.id = l.campus_id
  LEFT JOIN public.institutions cam_inst
    ON cam_inst.campus_id = l.campus_id
    AND cam_inst.type = 'school'
  LEFT JOIN public.jd_category_mappings jdm
    ON lower(jdm.category) = lower(l.jd_category)
  WHERE l.counsellor_id IS NULL
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible')
    AND COALESCE(l.person_role, 'lead') = 'lead';
$$;

GRANT EXECUTE ON FUNCTION public.get_unassigned_leads_bucket() TO authenticated;
