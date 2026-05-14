-- Multi-team routing: Management and Law leads round-robin across BOTH the
-- vertical team AND Grn Counselling, so the catch-all team helps absorb load.
--
--   Mirai campus         → [Mirai Admissions]
--   School institution   → [NSAE II Admissions]
--   Education department → [Grn BEd Admissions]
--   Law department       → [Grn Law Admissions, Grn Counselling]
--   Management dept      → [Grn Mgmt Faculty Admissions, Grn Counselling]
--   Everything else      → [Grn Counselling]
--
-- The previous fn_team_for_lead returned a single team name. We rename to
-- fn_teams_for_lead returning text[] and update fn_round_robin_assign_counsellor
-- to pool members across the array. Old function dropped.
--
-- Hybrid-campus note: Ghaziabad C2/C3 and similar campuses host BOTH a school
-- and a college institution under one campus_id. School detection must follow
-- the course's department→institution chain, not "any institution at the
-- campus" (which would mis-classify college courses as school). When the lead
-- has no course, fall back to campus institution type only if the campus has
-- exactly one institution.

DROP FUNCTION IF EXISTS public.fn_team_for_lead(uuid);

CREATE OR REPLACE FUNCTION public.fn_teams_for_lead(_lead_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus_name text;
  v_course_id   uuid;
  v_inst_type   text;
  v_dept_name   text;
  v_campus_inst_distinct int;
BEGIN
  SELECT cam.name, l.course_id, d.name
    INTO v_campus_name, v_course_id, v_dept_name
  FROM public.leads l
  LEFT JOIN public.campuses    cam ON cam.id = l.campus_id
  LEFT JOIN public.courses     co  ON co.id  = l.course_id
  LEFT JOIN public.departments d   ON d.id   = co.department_id
  WHERE l.id = _lead_id
  LIMIT 1;

  IF v_course_id IS NOT NULL THEN
    SELECT i.type INTO v_inst_type
    FROM public.courses co
    JOIN public.departments d  ON d.id = co.department_id
    JOIN public.institutions i ON i.id = d.institution_id
    WHERE co.id = v_course_id
    LIMIT 1;
  ELSE
    SELECT COUNT(DISTINCT i.type) INTO v_campus_inst_distinct
    FROM public.institutions i
    JOIN public.leads l ON l.campus_id = i.campus_id
    WHERE l.id = _lead_id;

    IF v_campus_inst_distinct = 1 THEN
      SELECT i.type INTO v_inst_type
      FROM public.institutions i
      JOIN public.leads l ON l.campus_id = i.campus_id
      WHERE l.id = _lead_id
      LIMIT 1;
    END IF;
  END IF;

  IF v_campus_name ILIKE '%Mirai%' THEN
    RETURN ARRAY['Mirai Admissions'];
  ELSIF v_inst_type = 'school' THEN
    RETURN ARRAY['NSAE II Admissions'];
  ELSIF v_dept_name = 'Education' THEN
    RETURN ARRAY['Grn BEd Admissions'];
  ELSIF v_dept_name = 'Law' THEN
    RETURN ARRAY['Grn Law Admissions', 'Grn Counselling'];
  ELSIF v_dept_name = 'Management' THEN
    RETURN ARRAY['Grn Mgmt Faculty Admissions', 'Grn Counselling'];
  ELSE
    RETURN ARRAY['Grn Counselling'];
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_teams_for_lead(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_round_robin_assign_counsellor(_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      uuid;
  v_teams         text[];
  v_counsellor_id uuid;
BEGIN
  SELECT counsellor_id INTO v_existing FROM public.leads WHERE id = _lead_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_teams := public.fn_teams_for_lead(_lead_id);

  -- Pool all distinct counsellors across the target team(s), pick least-loaded.
  WITH eligible AS (
    SELECT DISTINCT p.id AS profile_id, p.user_id
    FROM public.teams t
    JOIN public.team_members tm ON tm.team_id = t.id
    JOIN public.profiles p      ON p.user_id  = tm.user_id
    JOIN public.user_roles ur   ON ur.user_id = p.user_id AND ur.role = 'counsellor'
    WHERE t.name = ANY(v_teams)
  ),
  loads AS (
    SELECT e.profile_id,
           COALESCE((
             SELECT COUNT(*) FROM public.lead_followups f
             WHERE f.user_id = e.user_id AND f.status = 'pending'
           ), 0) AS load
    FROM eligible e
  )
  SELECT profile_id INTO v_counsellor_id
  FROM loads
  ORDER BY load ASC, random()
  LIMIT 1;

  -- Fallback to Grn Counselling if every target team is empty.
  IF v_counsellor_id IS NULL AND NOT ('Grn Counselling' = ANY(v_teams)) THEN
    WITH eligible AS (
      SELECT p.id AS profile_id, p.user_id
      FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      JOIN public.profiles p      ON p.user_id  = tm.user_id
      JOIN public.user_roles ur   ON ur.user_id = p.user_id AND ur.role = 'counsellor'
      WHERE t.name = 'Grn Counselling'
    ),
    loads AS (
      SELECT e.profile_id,
             COALESCE((
               SELECT COUNT(*) FROM public.lead_followups f
               WHERE f.user_id = e.user_id AND f.status = 'pending'
             ), 0) AS load
      FROM eligible e
    )
    SELECT profile_id INTO v_counsellor_id
    FROM loads
    ORDER BY load ASC, random()
    LIMIT 1;
  END IF;

  IF v_counsellor_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads
     SET counsellor_id = v_counsellor_id,
         updated_at    = now()
   WHERE id = _lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (_lead_id, 'system',
          format('Auto-assigned via round-robin (teams: %s)',
                 array_to_string(v_teams, ', ')));

  RETURN v_counsellor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_round_robin_assign_counsellor(uuid) TO authenticated, service_role;
