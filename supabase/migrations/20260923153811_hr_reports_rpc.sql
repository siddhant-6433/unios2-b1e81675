-- HR reporting RPCs (P2). A single place for the numbers a headcount/attendance/
-- leave/payroll/recruitment dashboard needs, so the UI does not have to page the
-- whole tables client-side (which the repo has been burned by before).
--
-- All are SECURITY DEFINER with an explicit permission check, STABLE, and
-- return aggregates only.

-- ── Headcount ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_headcount_summary()
RETURNS TABLE (
  legal_entity text, department text, campus text, employment_status text,
  worker_type text, headcount bigint, on_probation bigint, joined_this_month bigint,
  exited_this_month bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(le.name, '—')                                    AS legal_entity,
    COALESCE(d.name,  '—')                                    AS department,
    COALESCE(c.name,  '—')                                    AS campus,
    COALESCE(e.employment_status, 'Working')                  AS employment_status,
    COALESCE(e.worker_type, 'Permanent')                      AS worker_type,
    count(*)::bigint                                          AS headcount,
    count(*) FILTER (WHERE e.probation_status = 'on_probation')::bigint AS on_probation,
    count(*) FILTER (WHERE e.date_of_joining >= date_trunc('month', current_date)::date)::bigint AS joined_this_month,
    count(*) FILTER (WHERE e.date_of_exit IS NOT NULL
                       AND e.date_of_exit >= date_trunc('month', current_date)::date)::bigint AS exited_this_month
  FROM public.employee_profiles e
  LEFT JOIN public.legal_entities le ON le.id = e.legal_entity_id
  LEFT JOIN public.departments d ON d.id = e.department_id
  LEFT JOIN public.campuses c ON c.id = e.campus_id
  WHERE e.verification_status = 'verified'
  GROUP BY 1, 2, 3, 4, 5
  ORDER BY 1, 2, 3, 4;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hr_headcount_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_headcount_summary() TO authenticated, service_role;

-- ── Attendance ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_attendance_summary(_from date, _to date)
RETURNS TABLE (
  employee_profile_id uuid, employee_name text, employee_number text,
  present_days bigint, absent_days bigint, avg_hours numeric, first_punch timestamptz, last_punch timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH emp AS (
    SELECT e.id, e.user_id,
           COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS name,
           e.employee_number
    FROM public.employee_profiles e
    WHERE e.verification_status = 'verified'
      AND (e.employment_status IS NULL OR e.employment_status IN ('Working', 'On Notice'))
  ),
  att AS (
    SELECT a.user_id, a.date,
           min(a.punch_in) AS p_in, max(a.punch_out) AS p_out
    FROM public.employee_attendance a
    WHERE a.date BETWEEN _from AND _to
    GROUP BY a.user_id, a.date
  )
  SELECT
    emp.id, emp.name, emp.employee_number,
    count(att.date)::bigint AS present_days,
    GREATEST(0, ((_to - _from + 1) - count(att.date)))::bigint AS absent_days,
    COALESCE(round(avg(
      CASE WHEN att.p_in IS NOT NULL AND att.p_out IS NOT NULL
           THEN EXTRACT(EPOCH FROM (att.p_out - att.p_in)) / 3600.0 END
    )::numeric, 2), 0) AS avg_hours,
    min(att.p_in) AS first_punch,
    max(att.p_out) AS last_punch
  FROM emp
  LEFT JOIN att ON att.user_id = emp.user_id
  GROUP BY emp.id, emp.name, emp.employee_number
  ORDER BY emp.name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hr_attendance_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_attendance_summary(date, date) TO authenticated, service_role;

-- ── Leave ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_leave_summary(_leave_year integer)
RETURNS TABLE (
  employee_profile_id uuid, employee_name text, leave_type text,
  entitled numeric, carried_forward numeric, used numeric, available numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    ent.employee_profile_id,
    COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))),
    COALESCE(t.name, t.code),
    ent.entitled_days, ent.carried_forward, ent.used_days, ent.available_days
  FROM public.employee_leave_entitlements ent
  JOIN public.employee_profiles e ON e.id = ent.employee_profile_id
  JOIN public.leave_types t ON t.id = ent.leave_type_id
  WHERE ent.leave_year = _leave_year
  ORDER BY 2, 3;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hr_leave_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_leave_summary(integer) TO authenticated, service_role;

-- ── Payroll cost ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_payroll_cost_summary(_from date, _to date)
RETURNS TABLE (
  cycle_id uuid, cycle_name text, legal_entity text, status text,
  employees bigint, gross_earnings numeric, deductions numeric, employer_cost numeric, net_pay numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    COALESCE(c.name, to_char(c.period_start, 'Mon YYYY')),
    COALESCE(le.name, '—'),
    c.status,
    count(l.id)::bigint,
    COALESCE(sum(l.gross_earnings), 0),
    COALESCE(sum(l.total_deductions), 0),
    COALESCE(sum(l.employer_cost), 0),
    COALESCE(sum(l.net_pay), 0)
  FROM public.payroll_cycles c
  LEFT JOIN public.payroll_lines l ON l.payroll_cycle_id = c.id
  LEFT JOIN public.legal_entities le ON le.id = c.legal_entity_id
  WHERE c.period_end >= _from AND c.period_start <= _to
  GROUP BY c.id, c.name, c.period_start, le.name, c.status
  ORDER BY c.period_start DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hr_payroll_cost_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_payroll_cost_summary(date, date) TO authenticated, service_role;

-- ── Attrition ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_attrition_summary(_from date, _to date)
RETURNS TABLE (
  exit_type text, exits bigint, avg_tenure_days numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT ex.exit_type,
         count(*)::bigint,
         COALESCE(round(avg(
           CASE WHEN e.date_of_joining IS NOT NULL AND ex.last_working_day IS NOT NULL
                THEN (ex.last_working_day - e.date_of_joining)::numeric END), 1), 0)
  FROM public.employee_exits ex
  JOIN public.employee_profiles e ON e.id = ex.employee_profile_id
  WHERE ex.status = 'completed'
    AND COALESCE(ex.last_working_day, ex.resignation_date) BETWEEN _from AND _to
  GROUP BY ex.exit_type
  ORDER BY 2 DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hr_attrition_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_attrition_summary(date, date) TO authenticated, service_role;

-- ── Recruitment funnel ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_recruitment_funnel(_from date, _to date)
RETURNS TABLE (status text, source text, applicants bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT ja.status, COALESCE(ja.applied_via, ja.source_channel), count(*)::bigint
  FROM public.job_applicants ja
  WHERE ja.created_at::date BETWEEN _from AND _to
  GROUP BY ja.status, COALESCE(ja.applied_via, ja.source_channel)
  ORDER BY 3 DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hr_recruitment_funnel(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_recruitment_funnel(date, date) TO authenticated, service_role;

-- ── Expense summary ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_expense_summary(_from date, _to date)
RETURNS TABLE (status text, category text, claims bigint, total numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:expenses_approve')
          OR public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT c.status, COALESCE(cat.name, '—'), count(*)::bigint, COALESCE(sum(c.amount), 0)
  FROM public.expense_claims c
  LEFT JOIN public.expense_categories cat ON cat.id = c.category_id
  WHERE c.expense_date BETWEEN _from AND _to
  GROUP BY c.status, cat.name
  ORDER BY 1, 4 DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hr_expense_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_expense_summary(date, date) TO authenticated, service_role;
