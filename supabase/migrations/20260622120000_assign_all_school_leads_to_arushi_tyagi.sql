-- Assign every school admissions lead to Arushi Tyagi and remove other
-- counsellor associations for those leads.
--
-- Scope:
--   - all non-mirror admissions leads, regardless of current stage
--   - school classification mirrors the Lead Buckets rules but intentionally
--     omits the unassigned/stage filters from get_unassigned_leads_bucket()
--   - job/vendor/non-lead records are excluded via person_role
--   - lead_counsellors rows are secondary assignments, so they are cleared
--     for affected leads after Arushi becomes the primary counsellor

DO $$
DECLARE
  v_arushi_profile_id uuid;
  v_profile_matches int;
  v_school_lead_count int;
  v_primary_updated int;
  v_secondary_deleted int;
  v_history_added int;
BEGIN
  SELECT count(*)::int, (array_agg(p.id ORDER BY p.id::text))[1]
    INTO v_profile_matches, v_arushi_profile_id
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'counsellor'::public.app_role
  WHERE lower(regexp_replace(btrim(p.display_name), '[[:space:]]+', ' ', 'g')) = 'arushi tyagi';

  IF v_profile_matches = 0 THEN
    RAISE EXCEPTION 'Could not assign school leads: no counsellor profile found for Arushi Tyagi';
  END IF;

  IF v_profile_matches > 1 THEN
    RAISE EXCEPTION 'Could not assign school leads: % counsellor profiles found for Arushi Tyagi', v_profile_matches;
  END IF;

  CREATE TEMP TABLE tmp_school_leads_for_arushi
  ON COMMIT DROP
  AS
  SELECT
    l.id,
    l.counsellor_id AS previous_counsellor_id,
    l.stage AS lead_stage_at_assignment,
    CASE
      WHEN inferred.school_brand = 'mirai' THEN 'Mirai IB Leads'
      ELSE 'CBSE School Leads'
    END AS bucket_name
  FROM public.leads l
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.departments d ON d.id = c.department_id
  LEFT JOIN public.institutions i ON i.id = d.institution_id
  LEFT JOIN LATERAL (
    SELECT ci.type
    FROM public.institutions ci
    WHERE ci.campus_id = l.campus_id
      AND ci.type = 'school'
    LIMIT 1
  ) cam_inst ON true
  LEFT JOIN LATERAL (
    SELECT jm.is_school
    FROM public.jd_category_mappings jm
    WHERE lower(jm.category) = lower(l.jd_category)
    LIMIT 1
  ) jdm ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN i.type IS NOT NULL THEN i.type
        WHEN cam_inst.type = 'school' THEN 'school'
        WHEN jdm.is_school = true THEN 'school'
        ELSE 'college'
      END AS bucket,
      CASE
        WHEN COALESCE(
          i.type,
          CASE WHEN cam_inst.type = 'school' THEN 'school' END,
          CASE WHEN jdm.is_school THEN 'school' END,
          'college'
        ) <> 'school' THEN NULL
        WHEN l.campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid THEN 'mirai'
        ELSE 'nimt'
      END AS school_brand
  ) inferred ON true
  WHERE inferred.bucket = 'school'
    AND COALESCE(l.is_mirror, false) = false
    AND COALESCE(l.person_role, 'lead') = 'lead';

  SELECT count(*)::int INTO v_school_lead_count FROM tmp_school_leads_for_arushi;

  UPDATE public.leads l
     SET counsellor_id = v_arushi_profile_id,
         updated_at = now()
  FROM tmp_school_leads_for_arushi s
  WHERE l.id = s.id
    AND l.counsellor_id IS DISTINCT FROM v_arushi_profile_id;

  GET DIAGNOSTICS v_primary_updated = ROW_COUNT;

  DELETE FROM public.lead_counsellors lc
  USING tmp_school_leads_for_arushi s
  WHERE lc.lead_id = s.id;

  GET DIAGNOSTICS v_secondary_deleted = ROW_COUNT;

  INSERT INTO public.lead_assignment_history (
    lead_id,
    assigned_to,
    previous_counsellor_id,
    assigned_by_profile_id,
    assigned_by_user_id,
    assignment_source,
    bucket_name,
    lead_stage_at_assignment,
    created_at
  )
  SELECT
    s.id,
    v_arushi_profile_id,
    s.previous_counsellor_id,
    NULL,
    NULL,
    'assigned',
    s.bucket_name,
    s.lead_stage_at_assignment,
    now()
  FROM tmp_school_leads_for_arushi s
  WHERE s.previous_counsellor_id IS DISTINCT FROM v_arushi_profile_id;

  GET DIAGNOSTICS v_history_added = ROW_COUNT;

  RAISE NOTICE
    'Assigned % school leads to Arushi Tyagi: % primary assignments changed, % secondary counsellor rows removed, % history rows added',
    v_school_lead_count,
    v_primary_updated,
    v_secondary_deleted,
    v_history_added;
END $$;
