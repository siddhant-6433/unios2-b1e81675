-- Team-scoped counsellor assignment.
--
-- Bug: fn_round_robin_assign_counsellor (rewritten 20260607150000) picked any
-- counsellor in the system regardless of team/campus/course, causing Law,
-- Management, BEd and Mirai leads to land on counsellors from unrelated
-- verticals (and on counsellors with no team at all). Diagnostic queries on
-- prod showed 6,000+ active leads currently sitting with the wrong counsellor.
--
-- Fix: a single helper fn_team_for_lead that returns the correct team name for
-- a lead's campus + institution type + course department, mirroring
-- voice-agent/server.ts:assignLeadRoundRobin. Both the SQL round-robin and the
-- ai-call-failed-handler edge function call this helper so the routing logic
-- lives in one place.

-- ─── Helper: pick the team that should own a lead ────────────────────
CREATE OR REPLACE FUNCTION public.fn_team_for_lead(_lead_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus_name text;
  v_inst_type   text;
  v_dept_name   text;
BEGIN
  SELECT cam.name, i.type, d.name
    INTO v_campus_name, v_inst_type, v_dept_name
  FROM public.leads l
  LEFT JOIN public.campuses    cam ON cam.id = l.campus_id
  LEFT JOIN public.institutions i  ON i.campus_id = l.campus_id
  LEFT JOIN public.courses     co  ON co.id = l.course_id
  LEFT JOIN public.departments d   ON d.id = co.department_id
  WHERE l.id = _lead_id
  LIMIT 1;

  -- Mirror voice-agent/server.ts assignLeadRoundRobin routing exactly:
  --   Mirai campus            → Mirai Admissions
  --   School institution      → NSAE II Admissions
  --   Education department    → Grn BEd Admissions
  --   Law department          → Grn Law Admissions
  --   Management department   → Grn Mgmt Faculty Admissions
  --   Anything else / fallback→ Grn Counselling
  IF v_campus_name ILIKE '%Mirai%' THEN
    RETURN 'Mirai Admissions';
  ELSIF v_inst_type = 'school' THEN
    RETURN 'NSAE II Admissions';
  ELSIF v_dept_name = 'Education' THEN
    RETURN 'Grn BEd Admissions';
  ELSIF v_dept_name = 'Law' THEN
    RETURN 'Grn Law Admissions';
  ELSIF v_dept_name = 'Management' THEN
    RETURN 'Grn Mgmt Faculty Admissions';
  ELSE
    RETURN 'Grn Counselling';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_team_for_lead(uuid) TO authenticated, service_role;

-- ─── Round-robin assignment, team-scoped ─────────────────────────────
-- Picks the least-loaded counsellor inside the lead's correct team. If that
-- team has no members, falls back to Grn Counselling (the catch-all). Returns
-- NULL only if both target and fallback teams are empty — better to leave a
-- lead unassigned than to dump it on someone in the wrong vertical.
CREATE OR REPLACE FUNCTION public.fn_round_robin_assign_counsellor(_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      uuid;
  v_team_name     text;
  v_counsellor_id uuid;
BEGIN
  SELECT counsellor_id INTO v_existing FROM public.leads WHERE id = _lead_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_team_name := public.fn_team_for_lead(_lead_id);

  -- Pick least-loaded counsellor in the target team.
  WITH eligible AS (
    SELECT p.id AS profile_id, p.user_id
    FROM public.teams t
    JOIN public.team_members tm ON tm.team_id = t.id
    JOIN public.profiles p      ON p.user_id  = tm.user_id
    JOIN public.user_roles ur   ON ur.user_id = p.user_id AND ur.role = 'counsellor'
    WHERE t.name = v_team_name
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

  -- Fallback to Grn Counselling if the target team is empty.
  IF v_counsellor_id IS NULL AND v_team_name <> 'Grn Counselling' THEN
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
          format('Auto-assigned via round-robin (team: %s)', v_team_name));

  RETURN v_counsellor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_round_robin_assign_counsellor(uuid) TO authenticated, service_role;
