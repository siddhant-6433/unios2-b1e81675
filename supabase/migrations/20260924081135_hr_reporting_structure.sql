-- HR team structure & reporting managers (Keka-style), plus expense routing.
--
-- `employee_profiles.reports_to` already exists but nothing let HR define it,
-- so it was never populated and expense approvals had no L1 to route to.
-- This adds the setter (with self/cycle validation), a team-structure read for
-- the HR table, and a self read so the reporting manager can be shown on the
-- employee's own profile.

CREATE INDEX IF NOT EXISTS employee_profiles_reports_to_idx
  ON public.employee_profiles (reports_to) WHERE reports_to IS NOT NULL;

-- ── Set a reporting manager ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_reporting_manager(
  _employee_profile_id uuid, _manager_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_user uuid;
  v_manager_name text;
  v_cycle boolean;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT user_id INTO v_emp_user FROM public.employee_profiles WHERE id = _employee_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  IF _manager_user_id IS NULL THEN
    UPDATE public.employee_profiles
       SET reports_to = NULL, reports_to_name = NULL
     WHERE id = _employee_profile_id;
    RETURN 'cleared';
  END IF;

  IF _manager_user_id = v_emp_user THEN
    RAISE EXCEPTION 'An employee cannot report to themselves';
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), btrim(concat_ws(' ', first_name, last_name)))
    INTO v_manager_name
    FROM public.employee_profiles WHERE user_id = _manager_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reporting manager must be an existing employee';
  END IF;

  -- Walk the manager chain upward; reaching the employee means a cycle.
  WITH RECURSIVE chain AS (
    SELECT _manager_user_id AS uid
    UNION ALL
    SELECT e.reports_to
      FROM public.employee_profiles e
      JOIN chain c ON e.user_id = c.uid
     WHERE e.reports_to IS NOT NULL
  )
  SELECT EXISTS (SELECT 1 FROM chain c WHERE c.uid = v_emp_user) INTO v_cycle;
  IF v_cycle THEN
    RAISE EXCEPTION 'That reporting line would create a cycle';
  END IF;

  UPDATE public.employee_profiles
     SET reports_to = _manager_user_id, reports_to_name = v_manager_name
   WHERE id = _employee_profile_id;

  RETURN 'set';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_reporting_manager(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reporting_manager(uuid, uuid) TO authenticated, service_role;

-- ── Read: team structure table for HR ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_team_structure()
RETURNS TABLE (
  employee_profile_id uuid,
  employee_name text,
  employee_number text,
  designation text,
  department text,
  campus text,
  employment_status text,
  manager_user_id uuid,
  manager_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
    e.employee_number,
    COALESCE(NULLIF(btrim(e.job_title), ''), dg.name) AS designation,
    d.name AS department,
    c.name AS campus,
    COALESCE(e.employment_status, 'Working'),
    e.reports_to,
    COALESCE(NULLIF(btrim(e.reports_to_name), ''),
             (SELECT COALESCE(NULLIF(btrim(m.display_name), ''), btrim(concat_ws(' ', m.first_name, m.last_name)))
                FROM public.employee_profiles m WHERE m.user_id = e.reports_to)) AS manager_name
  FROM public.employee_profiles e
  LEFT JOIN public.designations dg ON dg.id = e.designation_id
  LEFT JOIN public.departments d ON d.id = e.department_id
  LEFT JOIN public.campuses c ON c.id = e.campus_id
  WHERE e.date_of_exit IS NULL
    AND (
      (SELECT public.has_permission(auth.uid(), 'hr:view'))
      OR (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
    )
  ORDER BY manager_name NULLS FIRST, employee_name;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_team_structure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_team_structure() TO authenticated, service_role;

-- ── Self read: who do I report to ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_reporting_manager()
RETURNS TABLE (manager_user_id uuid, manager_name text, manager_designation text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_emp public.employee_profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_emp FROM public.employee_profiles WHERE user_id = auth.uid();
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT v_emp.reports_to,
         COALESCE(NULLIF(btrim(v_emp.reports_to_name), ''),
                  (SELECT COALESCE(NULLIF(btrim(m.display_name), ''), btrim(concat_ws(' ', m.first_name, m.last_name)))
                     FROM public.employee_profiles m WHERE m.user_id = v_emp.reports_to)),
         (SELECT COALESCE(NULLIF(btrim(m.job_title), ''), dg.name)
            FROM public.employee_profiles m
            LEFT JOIN public.designations dg ON dg.id = m.designation_id
           WHERE m.user_id = v_emp.reports_to)
   WHERE v_emp.reports_to IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_reporting_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_reporting_manager() TO authenticated, service_role;

COMMENT ON FUNCTION public.set_reporting_manager(uuid, uuid) IS
  'HR sets an employee''s reporting manager (employee_profiles.reports_to), rejecting self-reporting and cycles.';
