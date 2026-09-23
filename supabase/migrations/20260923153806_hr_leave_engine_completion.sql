-- HR leave engine completion (P0/P1).
--
-- The leave plans → types → entitlements model shipped, but three things were
-- unfinished:
--   * leave requests were only visible/actionable by the requester or a
--     super_admin — campus_admin, principal and hr:leave_approve holders had no
--     path. There was no approval RPC and no notification.
--   * `leave_types.accrual = 'monthly'` and `carry_forward_max` were modelled
--     but ignored: every type was granted its full annual quota at once.
--   * the usage-sync trigger only ran when the new leave_type_id /
--     employee_profile_id columns were set, which the self-service UI never
--     does, so balances never moved for a normal employee request.
--
-- This migration fixes all three, plus adds the LOP / calendar helpers payroll
-- and the UI need.

-- ── Leave-year maths (honours year_start_month, not calendar year) ──────────

CREATE OR REPLACE FUNCTION public.leave_year_for(_on date, _start_month smallint)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT EXTRACT(YEAR FROM _on)::int
         - CASE WHEN EXTRACT(MONTH FROM _on)::int >= _start_month THEN 0 ELSE 1 END;
$$;

CREATE OR REPLACE FUNCTION public.leave_completed_months(_leave_year integer, _start_month smallint, _as_of date)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(12, GREATEST(0,
    (EXTRACT(YEAR FROM _as_of)::int - _leave_year) * 12
    + (EXTRACT(MONTH FROM _as_of)::int - _start_month) + 1
  ));
$$;

CREATE OR REPLACE FUNCTION public.leave_entitlement_days(
  _annual_days numeric, _accrual text, _leave_year integer, _start_month smallint, _as_of date
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _accrual <> 'monthly' THEN round(_annual_days, 2)
    ELSE round((_annual_days / 12.0) * public.leave_completed_months(_leave_year, _start_month, _as_of), 2)
  END;
$$;

-- ── Accrual: internal worker + permission-checked wrapper ───────────────────

CREATE OR REPLACE FUNCTION public.fn_accrue_leave_plan(
  _leave_plan_id uuid, _leave_year integer, _as_of date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start smallint;
  v_count integer := 0;
BEGIN
  SELECT year_start_month INTO v_start FROM public.leave_plans WHERE id = _leave_plan_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  INSERT INTO public.employee_leave_entitlements
    (employee_profile_id, leave_type_id, leave_year, entitled_days, carried_forward)
  SELECT
    e.id,
    t.id,
    _leave_year,
    public.leave_entitlement_days(t.annual_days, t.accrual, _leave_year, v_start, _as_of),
    CASE
      WHEN t.carry_forward_max > 0 THEN
        LEAST(t.carry_forward_max, GREATEST(0,
          COALESCE(prev.entitled_days + prev.carried_forward - prev.used_days, 0)))
      ELSE 0
    END
  FROM public.employee_profiles e
  JOIN public.leave_types t ON t.leave_plan_id = _leave_plan_id
  LEFT JOIN public.employee_leave_entitlements prev
    ON prev.employee_profile_id = e.id
   AND prev.leave_type_id = t.id
   AND prev.leave_year = _leave_year - 1
  WHERE e.leave_plan_id = _leave_plan_id
    AND e.verification_status = 'verified'
    AND (e.employment_status IS NULL OR e.employment_status IN ('Working', 'On Notice'))
  ON CONFLICT (employee_profile_id, leave_type_id, leave_year)
  DO UPDATE SET entitled_days    = EXCLUDED.entitled_days,
                carried_forward  = EXCLUDED.carried_forward,
                updated_at       = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_accrue_leave_plan(uuid, integer, date) FROM PUBLIC, anon, authenticated;

-- Permission-checked entry point used by HR. Now pro-rates monthly types and
-- applies carry-forward (see fn_accrue_leave_plan).
CREATE OR REPLACE FUNCTION public.grant_leave_entitlements(_leave_plan_id uuid, _leave_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:leave_approve') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN public.fn_accrue_leave_plan(_leave_plan_id, _leave_year, current_date);
END;
$$;

-- Cron worker: accrues the current leave year for every active plan.
CREATE OR REPLACE FUNCTION public.run_leave_accrual(_as_of date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  v_total integer := 0;
  v_year integer;
BEGIN
  FOR p IN SELECT id, year_start_month FROM public.leave_plans WHERE is_active LOOP
    v_year := public.leave_year_for(COALESCE(_as_of, current_date), p.year_start_month);
    v_total := v_total + public.fn_accrue_leave_plan(p.id, v_year, COALESCE(_as_of, current_date));
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_leave_accrual(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_leave_accrual(date) TO service_role;

-- ── Usage sync: derive the profile/type/year for self-service requests ──────

CREATE OR REPLACE FUNCTION public.sync_leave_entitlement_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_type    uuid;
  v_start   smallint;
  v_year    integer;
BEGIN
  -- Self-service inserts only know user_id + the legacy text leave_type, so
  -- resolve the employee profile and the plan's leave type from those.
  v_profile := NEW.employee_profile_id;
  IF v_profile IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = NEW.user_id;
  END IF;
  IF v_profile IS NULL THEN RETURN NULL; END IF;

  v_type := NEW.leave_type_id;
  IF v_type IS NULL THEN
    SELECT t.id INTO v_type
      FROM public.employee_profiles e
      JOIN public.leave_types t ON t.leave_plan_id = e.leave_plan_id
     WHERE e.id = v_profile
       AND lower(t.code) = lower(CASE lower(NEW.leave_type)
             WHEN 'casual'    THEN 'CL'
             WHEN 'sick'      THEN 'SL'
             WHEN 'earned'    THEN 'EL'
             WHEN 'unpaid'    THEN 'LWP'
             ELSE NEW.leave_type END)
     LIMIT 1;
  END IF;

  -- No resolvable type → there is no entitlement row to move.
  IF v_type IS NULL THEN RETURN NULL; END IF;

  SELECT lp.year_start_month INTO v_start
    FROM public.leave_types t JOIN public.leave_plans lp ON lp.id = t.leave_plan_id
   WHERE t.id = v_type;
  IF v_start IS NULL THEN v_start := 1; END IF;

  -- Recompute from the approved requests themselves (no double counting).
  v_year := public.leave_year_for(NEW.start_date, v_start);

  UPDATE public.employee_leave_entitlements ent
     SET used_days = COALESCE((
           SELECT sum(r.days) FROM public.employee_leave_requests r
            WHERE r.employee_profile_id = v_profile
              AND (r.leave_type_id = v_type OR (r.leave_type_id IS NULL AND v_type IS NULL))
              AND r.status = 'approved'
              AND public.leave_year_for(r.start_date, v_start) = v_year
         ), 0),
         updated_at = now()
   WHERE ent.employee_profile_id = v_profile
     AND ent.leave_type_id = v_type
     AND ent.leave_year = v_year;

  RETURN NULL;
END;
$$;

-- ── Approval RPC + notification ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decide_leave_request(
  _request_id uuid, _approve boolean, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.employee_leave_requests;
  v_uid uuid;
  v_status text := CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:leave_approve')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO r FROM public.employee_leave_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is already %', r.status; END IF;

  UPDATE public.employee_leave_requests
     SET status = v_status,
         approved_by = auth.uid(),
         approved_at = now()
   WHERE id = _request_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = r.employee_profile_id;
  v_uid := COALESCE(v_uid, r.user_id);
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      v_uid,
      'leave_decision',
      CASE WHEN _approve THEN 'Leave approved' ELSE 'Leave rejected' END,
      COALESCE(_note, CASE WHEN _approve
        THEN 'Your leave request was approved.'
        ELSE 'Your leave request was rejected.' END),
      '/my-hr'
    );
  END IF;

  RETURN v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated, service_role;

-- ── RLS: let HR see and action leave requests ───────────────────────────────

DROP POLICY IF EXISTS "HR reads leave requests" ON public.employee_leave_requests;
CREATE POLICY "HR reads leave requests"
  ON public.employee_leave_requests FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:leave_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
  );

DROP POLICY IF EXISTS "HR actions leave requests" ON public.employee_leave_requests;
CREATE POLICY "HR actions leave requests"
  ON public.employee_leave_requests FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')));

-- ── Indexes the sync trigger and UI filters need ────────────────────────────

CREATE INDEX IF NOT EXISTS employee_leave_requests_profile_idx
  ON public.employee_leave_requests (employee_profile_id, status, start_date);
CREATE INDEX IF NOT EXISTS employee_leave_requests_type_idx
  ON public.employee_leave_requests (leave_type_id, status);

-- ── LOP + calendar helpers ──────────────────────────────────────────────────

-- Approved unpaid days in a payroll period, for the payroll run to deduct.
CREATE OR REPLACE FUNCTION public.employee_lop_days(
  _employee_profile_id uuid, _from date, _to date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_days numeric;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_permission(auth.uid(), 'hr:view')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(sum(r.days), 0) INTO v_days
  FROM public.employee_leave_requests r
  LEFT JOIN public.leave_types t ON t.id = r.leave_type_id
  WHERE r.employee_profile_id = _employee_profile_id
    AND r.status = 'approved'
    AND r.start_date <= _to
    AND r.end_date >= _from
    AND (t.is_paid IS FALSE OR lower(r.leave_type) IN ('unpaid', 'lwp'));
  RETURN v_days;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.employee_lop_days(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_lop_days(uuid, date, date) TO authenticated, service_role;

-- Team leave calendar for HR / managers.
CREATE OR REPLACE FUNCTION public.leave_calendar(_from date, _to date)
RETURNS TABLE (
  request_id uuid, employee_profile_id uuid, employee_name text, leave_type text,
  start_date date, end_date date, days integer, status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.employee_profile_id,
         COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))),
         COALESCE(t.name, initcap(r.leave_type)),
         r.start_date, r.end_date, r.days, r.status
  FROM public.employee_leave_requests r
  LEFT JOIN public.employee_profiles e ON e.id = r.employee_profile_id
  LEFT JOIN public.leave_types t ON t.id = r.leave_type_id
  WHERE r.status = 'approved'
    AND r.start_date <= _to
    AND r.end_date >= _from
    AND (
      (SELECT public.has_permission(auth.uid(), 'hr:view'))
      OR (SELECT public.has_permission(auth.uid(), 'hr:leave_approve'))
    )
  ORDER BY r.start_date;
$$;

REVOKE EXECUTE ON FUNCTION public.leave_calendar(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_calendar(date, date) TO authenticated, service_role;
