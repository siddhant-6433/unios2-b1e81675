-- Mirai routing fix: voice-agent/server.ts identifies Mirai leads via a
-- hardcoded campus UUID (c0000002-0000-0000-0000-000000000001), but no row
-- in the campuses table has that name, so fn_teams_for_lead's
-- `cam.name ILIKE '%Mirai%'` branch was unreachable. 89 leads currently
-- pointing at that UUID were silently falling through to BEd / Counselling
-- / NSAE II depending on their course.
--
-- Fix: short-circuit on the same UUID the voice-agent uses, before the
-- name check (which we keep as a safety net for any future Mirai campus
-- rows that get added).

CREATE OR REPLACE FUNCTION public.fn_teams_for_lead(_lead_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus_id   uuid;
  v_campus_name text;
  v_course_id   uuid;
  v_inst_type   text;
  v_dept_name   text;
  v_campus_inst_distinct int;
BEGIN
  SELECT l.campus_id, cam.name, l.course_id, d.name
    INTO v_campus_id, v_campus_name, v_course_id, v_dept_name
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

  -- Mirai detection: prefer UUID (matches voice-agent/server.ts), fall back to name.
  IF v_campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid
     OR v_campus_name ILIKE '%Mirai%' THEN
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
