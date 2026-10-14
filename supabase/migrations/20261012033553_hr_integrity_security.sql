-- keep-migration-version: restored production migration 20261012033553; preserve its applied version.
CREATE OR REPLACE FUNCTION public.hr_revoke_sessions_internal(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 BEGIN DELETE FROM auth.sessions WHERE user_id=_user_id; EXCEPTION WHEN undefined_table THEN NULL; END;
 DELETE FROM auth.refresh_tokens WHERE user_id=_user_id::text;
END $$;
REVOKE ALL ON FUNCTION public.hr_revoke_sessions_internal(uuid) FROM PUBLIC,anon,authenticated;
-- Employee account status is enforced at the data boundary, including old access tokens.
CREATE OR REPLACE FUNCTION public.is_account_active(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT _user_id IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM public.profiles WHERE user_id = _user_id AND(login_disabled OR archived_at IS NOT NULL OR deleted_at IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM employee_exits x JOIN employee_profiles e ON e.id=x.employee_profile_id
 WHERE e.user_id=_user_id AND x.status<>'reverted' AND NULLIF(to_jsonb(x)->>'access_cutoff_at','')::timestamptz<=now());
$$;
REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_account_active(_user_id) AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
    AND (
      role = _role
      OR (role = 'school_coordinator' AND _role = 'office_assistant')
      OR (role = 'office_admin' AND _role = 'accountant')
      OR (role = 'vice_principal' AND _role = 'principal')
    )
  )
$$;
CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_perms AS (
    SELECT p.module || ':' || p.action AS pkey
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role IN (SELECT role FROM public.user_roles WHERE user_id = _user_id)
  ),
  overrides AS (
    SELECT p.module || ':' || p.action AS pkey, upo.granted
    FROM user_permission_overrides upo
    JOIN permissions p ON p.id = upo.permission_id
    WHERE upo.user_id = _user_id
  )
  SELECT COALESCE(array_agg(DISTINCT final.pkey), ARRAY[]::text[])
  FROM (
    SELECT rp.pkey FROM role_perms rp
    WHERE NOT EXISTS (SELECT 1 FROM overrides o WHERE o.pkey = rp.pkey AND o.granted = false)
    UNION
    SELECT o.pkey FROM overrides o WHERE o.granted = true
  ) final WHERE public.is_account_active(_user_id);
$$;


CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
 IF COALESCE(auth.role(), '') <> 'service_role'
    AND NOT public.has_role(auth.uid(), 'super_admin') THEN
   RAISE EXCEPTION 'Forbidden';
 END IF;
 BEGIN DELETE FROM auth.sessions WHERE user_id = _user_id;
 EXCEPTION WHEN undefined_table THEN NULL; END;
 DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid) TO authenticated, service_role;

-- Restrictive policies supplement existing owner/role policies, never widen them.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind='r' AND c.relrowsecurity LOOP
  EXECUTE format('DROP POLICY IF EXISTS active_account_required ON %I.%I',r.nspname,r.relname);
  EXECUTE format('CREATE POLICY active_account_required ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_account_active(auth.uid()))) WITH CHECK ((SELECT public.is_account_active(auth.uid())))',r.nspname,r.relname);
 END LOOP;
END $$;

-- Payroll inputs and all breakdown rows are saved as one transaction.
ALTER TABLE public.payroll_lines ADD COLUMN IF NOT EXISTS employed_days numeric(6,2);
CREATE OR REPLACE FUNCTION public.hr_payroll_context(_cycle_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.payroll_cycles; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO c FROM payroll_cycles WHERE id=_cycle_id;
 IF NOT FOUND OR c.status NOT IN ('draft','processing') THEN RAISE EXCEPTION 'Run is missing or locked'; END IF;
 SELECT jsonb_build_object('rates',COALESCE((
  SELECT jsonb_agg(to_jsonb(r)) FROM (
   SELECT DISTINCT ON (key) key,numeric_value FROM payroll_statutory_config
   WHERE (legal_entity_id=c.legal_entity_id OR legal_entity_id IS NULL) AND effective_from<=c.period_end
   ORDER BY key,(legal_entity_id IS NOT NULL) DESC,effective_from DESC,created_at DESC,id
  ) r), '[]'::jsonb), 'lines', COALESCE((
  SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object(
   'monthly_gross',es.monthly_gross,
   'employed_days',COALESCE(l.employed_days,GREATEST(0,LEAST(c.period_end,COALESCE(e.date_of_exit,c.period_end))-GREATEST(c.period_start,COALESCE(e.date_of_joining,c.period_start))+1)),
   'components',COALESCE((SELECT jsonb_agg(to_jsonb(sc) || jsonb_build_object('value',ssc.value) ORDER BY sc.code)
    FROM salary_structure_components ssc JOIN salary_components sc ON sc.id=ssc.component_id
    WHERE ssc.salary_structure_id=es.salary_structure_id AND sc.is_active),'[]'::jsonb)) ORDER BY l.id)
  FROM payroll_lines l JOIN employee_profiles e ON e.id=l.employee_profile_id
  LEFT JOIN LATERAL (SELECT * FROM employee_salaries s WHERE s.employee_profile_id=e.id
    AND s.effective_from<=c.period_end AND (s.effective_to IS NULL OR s.effective_to>=c.period_start)
    ORDER BY s.effective_from DESC,s.id LIMIT 1) es ON true
  WHERE l.payroll_cycle_id=c.id), '[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.hr_payroll_context(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payroll_context(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_save_payroll(_cycle_id uuid,_results jsonb,_expected_context jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.payroll_cycles; item jsonb; comp jsonb; l public.payroll_lines; r jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO c FROM payroll_cycles WHERE id=_cycle_id FOR UPDATE;
 IF NOT FOUND OR c.status NOT IN ('draft','processing') THEN RAISE EXCEPTION 'Run is missing or locked'; END IF;
 IF public.hr_payroll_context(_cycle_id) IS DISTINCT FROM _expected_context THEN RAISE EXCEPTION 'Payroll inputs changed. Reload and calculate again.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_results) LOOP
  SELECT * INTO l FROM payroll_lines WHERE id=(item->>'id')::uuid AND payroll_cycle_id=c.id FOR UPDATE;
  IF NOT FOUND OR l.on_hold THEN RAISE EXCEPTION 'Line unavailable'; END IF;
  IF l.updated_at IS DISTINCT FROM (item->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Payroll changed. Reload and calculate again.'; END IF;
  r:=item->'result';
  UPDATE payroll_lines SET monthly_gross=(item->>'monthly_gross')::numeric,employed_days=(item->>'employed_days')::numeric,gross_earnings=(r->>'grossEarnings')::numeric,total_deductions=(r->>'totalDeductions')::numeric,
   employer_cost=(r->>'employerCost')::numeric,net_pay=(r->>'netPay')::numeric,payable_days=(r->>'payableDays')::numeric,
   updated_at=clock_timestamp() WHERE id=l.id;
  DELETE FROM payroll_line_components WHERE payroll_line_id=l.id;
  FOR comp IN SELECT value FROM jsonb_array_elements(r->'components') LOOP
   INSERT INTO payroll_line_components(payroll_line_id,component_code,component_name,kind,amount,display_order)
   VALUES(l.id,comp->>'code',comp->>'name',comp->>'kind',(comp->>'amount')::numeric,(comp->>'display_order')::integer);
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.hr_save_payroll(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hr_save_payroll(uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_employee_salary(_employee_profile_id uuid,_monthly_gross numeric,
 _annual_ctc numeric,_effective_from date,_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.employee_salaries;
BEGIN
 IF NOT public.has_permission(auth.uid(),'hr:payroll_run') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF _monthly_gross IS NULL OR _monthly_gross::text IN ('NaN','Infinity','-Infinity') OR _monthly_gross<0 OR _effective_from IS NULL THEN RAISE EXCEPTION 'Invalid salary'; END IF;
 PERFORM 1 FROM employee_profiles WHERE id=_employee_profile_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee missing'; END IF;
 SELECT * INTO s FROM employee_salaries WHERE employee_profile_id=_employee_profile_id AND effective_to IS NULL FOR UPDATE;
 IF FOUND THEN
  IF s.effective_from>_effective_from THEN RETURN 'skipped'; END IF;
  IF s.effective_from=_effective_from THEN
   UPDATE employee_salaries SET monthly_gross=_monthly_gross,annual_ctc=_annual_ctc,revision_note=_note WHERE id=s.id;
   RETURN 'updated';
  END IF;
  UPDATE employee_salaries SET effective_to=_effective_from-1 WHERE id=s.id;
 END IF;
 INSERT INTO employee_salaries(employee_profile_id,monthly_gross,annual_ctc,effective_from,source,revision_note,created_by,salary_structure_id)
 VALUES(_employee_profile_id,_monthly_gross,_annual_ctc,_effective_from,'keka_ctc_import',_note,auth.uid(),s.salary_structure_id);
 RETURN 'inserted';
END $$;
REVOKE ALL ON FUNCTION public.replace_employee_salary(uuid,numeric,numeric,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_employee_salary(uuid,numeric,numeric,date,text) TO authenticated;

ALTER TABLE public.employee_leave_entitlements ADD COLUMN IF NOT EXISTS opening_used_days numeric NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS opening_entitlement_adjustment numeric NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS opening_recorded_at timestamptz;

-- Normalize identifiers BEFORE usage aggregation and protect employee transitions.
CREATE OR REPLACE FUNCTION public.hr_normalize_leave_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.employee_profiles; t public.leave_types; editor boolean;
BEGIN
 SELECT * INTO e FROM employee_profiles WHERE user_id=NEW.user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee missing'; END IF;
 editor:=public.has_permission(auth.uid(),'hr:leave_approve') OR auth.role()='service_role';
 IF NOT editor THEN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL) THEN RAISE EXCEPTION 'Leave must start pending'; END IF;
  IF TG_OP='UPDATE' AND (OLD.status<>'pending' OR NEW.status<>'cancelled'
   OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')) THEN RAISE EXCEPTION 'Only cancellation is allowed'; END IF;
 END IF;
 IF NEW.end_date<NEW.start_date OR NEW.days<=0 OR NEW.days>NEW.end_date-NEW.start_date+1 THEN RAISE EXCEPTION 'Invalid leave dates or days'; END IF;
 IF NEW.employee_profile_id IS NOT NULL AND NEW.employee_profile_id<>e.id THEN RAISE EXCEPTION 'Employee mismatch'; END IF;
 NEW.employee_profile_id:=e.id;
 SELECT * INTO t FROM leave_types WHERE leave_plan_id=e.leave_plan_id AND
  (id=NEW.leave_type_id OR (NEW.leave_type_id IS NULL AND lower(code)=lower(CASE lower(NEW.leave_type) WHEN 'casual' THEN 'CL' WHEN 'sick' THEN 'SL' WHEN 'earned' THEN 'EL' WHEN 'unpaid' THEN 'LWP' ELSE NEW.leave_type END))) LIMIT 1;
 IF NEW.leave_type_id IS NOT NULL AND t.id IS NULL THEN RAISE EXCEPTION 'Leave type does not belong to employee plan'; END IF;
 NEW.leave_type_id:=t.id;
 RETURN NEW;
END $$;
UPDATE public.employee_leave_requests r SET employee_profile_id=e.id,
 leave_type_id=(SELECT t.id FROM public.leave_types t WHERE t.leave_plan_id=e.leave_plan_id AND lower(t.code)=lower(CASE lower(r.leave_type) WHEN 'casual' THEN 'CL' WHEN 'sick' THEN 'SL' WHEN 'earned' THEN 'EL' WHEN 'unpaid' THEN 'LWP' ELSE r.leave_type END) LIMIT 1)
 FROM public.employee_profiles e WHERE r.user_id=e.user_id AND r.employee_profile_id IS NULL;
DROP TRIGGER IF EXISTS hr_normalize_leave_request ON public.employee_leave_requests;
CREATE TRIGGER hr_normalize_leave_request BEFORE INSERT OR UPDATE ON public.employee_leave_requests FOR EACH ROW EXECUTE FUNCTION public.hr_normalize_leave_request();
DROP POLICY IF EXISTS "Employees cancel own pending leave" ON public.employee_leave_requests;

DROP POLICY IF EXISTS "Users can cancel own leave requests" ON public.employee_leave_requests;
DROP POLICY IF EXISTS "Users can cancel own leave requests" ON public.employee_leave_requests;
CREATE POLICY "Users can cancel own leave requests" ON public.employee_leave_requests FOR UPDATE TO authenticated
 USING(user_id=auth.uid() AND status='pending') WITH CHECK(user_id=auth.uid() AND status='cancelled');

CREATE OR REPLACE FUNCTION public.leave_overlap_days(_days numeric,_start date,_end date,_from date,_to date)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN _end<_start THEN 0 ELSE round(_days*GREATEST(0,LEAST(_end,_to)-GREATEST(_start,_from)+1)::numeric/(_end-_start+1),2) END;
$$;
CREATE OR REPLACE FUNCTION public.sync_leave_entitlement_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE employee_leave_entitlements ent SET used_days=ent.opening_used_days+COALESCE((
  SELECT sum(public.leave_overlap_days(r.days,r.start_date,r.end_date,
    make_date(ent.leave_year,lp.year_start_month,1), (make_date(ent.leave_year,lp.year_start_month,1)+interval '1 year'-interval '1 day')::date))
  FROM employee_leave_requests r WHERE r.employee_profile_id=ent.employee_profile_id
   AND r.leave_type_id=ent.leave_type_id AND r.status='approved' AND(ent.opening_recorded_at IS NULL OR r.approved_at>ent.opening_recorded_at)),0),updated_at=now()
 FROM leave_types t JOIN leave_plans lp ON lp.id=t.leave_plan_id
 WHERE ent.leave_type_id=t.id AND ent.employee_profile_id IN (NEW.employee_profile_id,OLD.employee_profile_id);
 RETURN NULL;
END $$;
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

  SELECT COALESCE(sum(public.leave_overlap_days(r.days,r.start_date,r.end_date,_from,_to)), 0) INTO v_days
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
    GREATEST(0,public.leave_entitlement_days(t.annual_days, t.accrual, _leave_year, v_start, _as_of)
      -COALESCE((SELECT sum(le.days) FROM public.leave_encashments le WHERE le.employee_profile_id=e.id
        AND le.leave_type_id=t.id AND le.leave_year=_leave_year AND le.status='paid'),0)
      -COALESCE((SELECT sum((j->>'days')::numeric) FROM employee_settlements st CROSS JOIN LATERAL jsonb_array_elements(st.leave_snapshot) j JOIN employee_leave_entitlements ent ON ent.id=(j->>'id')::uuid WHERE st.employee_profile_id=e.id AND st.status='paid' AND ent.leave_type_id=t.id AND ent.leave_year=_leave_year),0)),
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
  DO UPDATE SET entitled_days    = GREATEST(0,EXCLUDED.entitled_days + employee_leave_entitlements.opening_entitlement_adjustment),
                carried_forward  = EXCLUDED.carried_forward,
                updated_at       = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
CREATE OR REPLACE FUNCTION public.request_leave_encashment(
  _leave_type_id uuid, _days numeric, _leave_year integer DEFAULT NULL, _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_salary numeric;
  v_div numeric := public.fnf_config('leave_encashment_divisor', 26);
  v_available numeric;
  v_year integer := COALESCE(_leave_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _days IS NULL OR _days <= 0 THEN RAISE EXCEPTION 'Days must be positive'; END IF;

  SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = auth.uid() FOR UPDATE;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'No employee record for this user'; END IF;

  SELECT ent.available_days INTO v_available
    FROM public.employee_leave_entitlements ent
   WHERE ent.employee_profile_id = v_profile
     AND ent.leave_type_id = _leave_type_id
     AND ent.leave_year = v_year;
  IF v_available IS NULL THEN RAISE EXCEPTION 'No leave balance for that type/year'; END IF;
  IF NOT EXISTS(SELECT 1 FROM leave_types WHERE id=_leave_type_id AND is_paid) THEN RAISE EXCEPTION 'Only paid leave can be encashed'; END IF;
  v_available:=v_available-COALESCE((SELECT sum(days) FROM leave_encashments WHERE employee_profile_id=v_profile AND leave_type_id=_leave_type_id AND leave_year=v_year AND status IN ('requested','approved')),0);
  IF _days > v_available THEN RAISE EXCEPTION 'Only % day(s) available', v_available; END IF;

  SELECT es.monthly_gross INTO v_salary
    FROM public.employee_salaries es
   WHERE es.employee_profile_id = v_profile AND es.effective_to IS NULL
   ORDER BY es.effective_from DESC LIMIT 1;
  v_salary := COALESCE(v_salary, 0);

  INSERT INTO public.leave_encashments
    (employee_profile_id, leave_type_id, leave_year, days, amount, status, requested_by, note)
  VALUES (v_profile, _leave_type_id, v_year, _days,
          round(_days * v_salary / GREATEST(v_div, 1)), 'requested', auth.uid(), _note)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.decide_leave_encashment(
  _encashment_id uuid, _approve boolean, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE enc public.leave_encashments; v_salary numeric; v_div numeric; v_uid uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:leave_approve')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO enc FROM public.leave_encashments WHERE id = _encashment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encashment not found'; END IF;
  IF enc.status <> 'requested' THEN RAISE EXCEPTION 'Encashment is already %', enc.status; END IF;

  v_div := public.fnf_config('leave_encashment_divisor', 26);
  SELECT es.monthly_gross INTO v_salary
    FROM public.employee_salaries es
   WHERE es.employee_profile_id = enc.employee_profile_id AND es.effective_to IS NULL
   ORDER BY es.effective_from DESC LIMIT 1;
  v_salary := COALESCE(v_salary, 0);

  UPDATE public.leave_encashments
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         amount = round(enc.days * v_salary / GREATEST(v_div, 1)),
         decided_by = auth.uid(), decided_at = now(), decision_note = _note
   WHERE id = _encashment_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = enc.employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'general',
            CASE WHEN _approve THEN 'Leave encashment approved' ELSE 'Leave encashment rejected' END,
            CASE WHEN _approve THEN 'Your leave encashment was approved and will be paid with payroll.'
                 ELSE COALESCE(_note, 'Your leave encashment was rejected.') END,
            '/my-hr');
  END IF;

  RETURN CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
END;
$$;
CREATE OR REPLACE FUNCTION public.pay_leave_encashment(
  _encashment_id uuid, _payroll_cycle_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE enc public.leave_encashments; v_uid uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO enc FROM public.leave_encashments WHERE id = _encashment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encashment not found'; END IF;
  IF enc.status='paid' THEN RETURN 'paid'; END IF;
  PERFORM 1 FROM employee_leave_entitlements WHERE employee_profile_id=enc.employee_profile_id AND leave_type_id=enc.leave_type_id AND leave_year=enc.leave_year AND available_days>=enc.days FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient leave balance'; END IF;
  IF enc.status <> 'approved' THEN RAISE EXCEPTION 'Encashment must be approved first (current: %)', enc.status; END IF;

  -- Consume the leave by reducing the entitlement (not used_days, which the
  -- leave-sync trigger recomputes).
  UPDATE public.employee_leave_entitlements
     SET entitled_days = GREATEST(entitled_days - enc.days, 0), updated_at = now()
   WHERE employee_profile_id = enc.employee_profile_id
     AND leave_type_id = enc.leave_type_id
     AND leave_year = enc.leave_year;

  UPDATE public.leave_encashments
     SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
         payroll_cycle_id = COALESCE(_payroll_cycle_id, payroll_cycle_id)
   WHERE id = _encashment_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = enc.employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'general', 'Leave encashment paid',
            '₹' || to_char(enc.amount, 'FM9999999990.00') || ' paid against encashed leave.', '/my-hr');
  END IF;

  RETURN 'paid';
END;
$$;
REVOKE INSERT,UPDATE,DELETE ON public.leave_encashments FROM authenticated;
ALTER TABLE public.employee_settlements ADD COLUMN IF NOT EXISTS advance_snapshot jsonb NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS leave_snapshot jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.leave_types ADD COLUMN IF NOT EXISTS encashable boolean NOT NULL DEFAULT false;
-- HR must explicitly configure eligibility; paid leave alone is not encashable.
CREATE OR REPLACE FUNCTION public.compute_exit_settlement(_exit_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  x public.employee_exits;
  e public.employee_profiles;
  v_salary numeric;
  v_lwd date;
  v_settlement uuid;
  v_month_start date;
  v_month_days int;
  v_final_days numeric;
  v_enc_div numeric;
  v_grat_days numeric;
  v_grat_min numeric;
  v_notice_div numeric;
  v_tenure numeric;
  v_enc_days numeric;
  v_enc_amount numeric;
  v_grat_amount numeric;
  v_notice_amount numeric;
  v_advance numeric;
  v_salary_amount numeric;
  v_required_lwd date;
  v_status text;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO x FROM public.employee_exits WHERE id = _exit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exit not found'; END IF;
  SELECT * INTO e FROM public.employee_profiles WHERE id = x.employee_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  SELECT status INTO v_status FROM public.employee_settlements WHERE exit_id = _exit_id;
  IF v_status IN ('finalized', 'paid') THEN
    RAISE EXCEPTION 'Settlement is already %; reopen it before recomputing', v_status;
  END IF;

  v_lwd := COALESCE(x.last_working_day, x.resignation_date, current_date);

  SELECT es.monthly_gross INTO v_salary
    FROM public.employee_salaries es
   WHERE es.employee_profile_id = e.id
     AND es.effective_from <= v_lwd
     AND (es.effective_to IS NULL OR es.effective_to >= v_lwd)
   ORDER BY es.effective_from DESC LIMIT 1;
  v_salary := COALESCE(v_salary, 0);

  v_enc_div    := public.fnf_config('fnf_encashment_divisor', 26);
  v_grat_days  := public.fnf_config('fnf_gratuity_days_per_year', 15);
  v_grat_min   := public.fnf_config('fnf_gratuity_min_years', 5);
  v_notice_div := public.fnf_config('fnf_notice_recovery_divisor', 30);

  -- Final-month salary, pro-rated to the last working day.
  v_month_start := date_trunc('month', v_lwd)::date;
  v_month_days  := (date_trunc('month', v_lwd) + interval '1 month' - interval '1 day')::date - v_month_start + 1;
  v_final_days := GREATEST(0,v_lwd-GREATEST(v_month_start,COALESCE(e.date_of_joining,v_month_start))+1);
  v_final_days := GREATEST(0,v_final_days-public.employee_lop_days(e.id,GREATEST(v_month_start,COALESCE(e.date_of_joining,v_month_start)),v_lwd));
  v_salary_amount := round(v_salary * v_final_days / GREATEST(v_month_days, 1));

  v_salary_amount:=GREATEST(0,v_salary_amount-COALESCE((SELECT sum(l.gross_earnings) FROM payroll_lines l JOIN payroll_cycles c ON c.id=l.payroll_cycle_id WHERE l.employee_profile_id=e.id AND c.status='paid' AND c.period_start<=v_lwd AND c.period_end>=v_month_start),0));

  -- Leave encashment: available days across paid leave types for the current year.
  SELECT COALESCE(sum(ent.available_days), 0) INTO v_enc_days
    FROM public.employee_leave_entitlements ent
    JOIN public.leave_types t ON t.id = ent.leave_type_id
   WHERE ent.employee_profile_id = e.id
     AND t.is_paid AND t.encashable
     AND ent.leave_year=public.leave_year_for(v_lwd,(SELECT year_start_month FROM leave_plans WHERE id=t.leave_plan_id))
     AND ent.available_days > 0;
  v_enc_amount := round(COALESCE(v_enc_days, 0) * v_salary / GREATEST(v_enc_div, 1));

  -- Gratuity: only after the minimum service, on gross as an estimate.
  v_tenure := CASE WHEN e.date_of_joining IS NOT NULL
                   THEN (v_lwd - e.date_of_joining)::numeric / 365.25 ELSE 0 END;
  v_grat_amount := CASE WHEN v_tenure >= v_grat_min
                        THEN round(v_salary * v_grat_days / GREATEST(v_enc_div, 1) * v_tenure)
                        ELSE 0 END;

  -- Short-notice recovery.
  v_notice_amount := 0;
  IF NOT x.notice_waived
     AND x.resignation_date IS NOT NULL
     AND COALESCE(e.notice_period_days, 0) > 0
  THEN
    v_required_lwd := x.resignation_date + COALESCE(e.notice_period_days, 0);
    IF v_required_lwd > v_lwd THEN
      v_notice_amount := round(v_salary * (v_required_lwd - v_lwd) / GREATEST(v_notice_div, 1));
    END IF;
  END IF;

  -- Outstanding advances.
  SELECT COALESCE(sum(outstanding), 0) INTO v_advance
    FROM public.expense_advances
   WHERE employee_profile_id = e.id AND status = 'open';

  INSERT INTO public.employee_settlements
    (employee_profile_id, exit_id, last_working_day, computed_at)
  VALUES (e.id, _exit_id, v_lwd, now())
  ON CONFLICT (exit_id) DO UPDATE SET
    employee_profile_id = EXCLUDED.employee_profile_id,
    last_working_day    = EXCLUDED.last_working_day,
    computed_at         = now(),
    updated_at          = now()
  RETURNING id INTO v_settlement;

  UPDATE employee_settlements SET advance_snapshot=COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.outstanding)) FROM expense_advances a WHERE a.employee_profile_id=e.id AND a.status='open'),'[]'::jsonb),
   leave_snapshot=COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ent.id,'days',ent.available_days)) FROM employee_leave_entitlements ent JOIN leave_types t ON t.id=ent.leave_type_id WHERE ent.employee_profile_id=e.id AND t.is_paid AND t.encashable AND ent.available_days>0 AND ent.leave_year=public.leave_year_for(v_lwd,(SELECT year_start_month FROM leave_plans WHERE id=t.leave_plan_id))),'[]'::jsonb)
   WHERE id=v_settlement;
  DELETE FROM public.employee_settlement_lines WHERE settlement_id = v_settlement;

  INSERT INTO public.employee_settlement_lines (settlement_id, code, name, kind, amount, detail, display_order) VALUES
    (v_settlement, 'SALARY_FINAL',     'Salary to last working day', 'earning',   v_salary_amount, v_final_days || ' of ' || v_month_days || ' days', 10),
    (v_settlement, 'LEAVE_ENCASH',     'Leave encashment',          'earning',   v_enc_amount,    COALESCE(v_enc_days,0) || ' days', 20),
    (v_settlement, 'GRATUITY',         'Gratuity',                  'earning',   v_grat_amount,   CASE WHEN v_tenure >= v_grat_min THEN round(v_tenure,1) || ' years' ELSE 'Not eligible (min ' || v_grat_min || ' years)' END, 30),
    (v_settlement, 'NOTICE_RECOVERY',  'Notice period recovery',    'deduction', v_notice_amount, CASE WHEN v_notice_amount > 0 THEN 'Short notice' ELSE 'None' END, 110),
    (v_settlement, 'ADVANCE_RECOVERY', 'Outstanding advances',      'deduction', v_advance,       NULL, 120)
  ;

  UPDATE public.employee_settlements s
     SET gross_earnings   = COALESCE((SELECT sum(amount) FROM public.employee_settlement_lines WHERE settlement_id = v_settlement AND kind = 'earning'), 0),
         total_deductions = COALESCE((SELECT sum(amount) FROM public.employee_settlement_lines WHERE settlement_id = v_settlement AND kind = 'deduction'), 0),
         net_settlement   = GREATEST(
                              COALESCE((SELECT sum(amount) FROM public.employee_settlement_lines WHERE settlement_id = v_settlement AND kind = 'earning'), 0)
                              - COALESCE((SELECT sum(amount) FROM public.employee_settlement_lines WHERE settlement_id = v_settlement AND kind = 'deduction'), 0), 0)
   WHERE s.id = v_settlement;

  UPDATE public.employee_exits
     SET final_settlement_amount = (SELECT net_settlement FROM public.employee_settlements WHERE id = v_settlement)
   WHERE id = _exit_id;

  RETURN v_settlement;
END;
$$;
CREATE OR REPLACE FUNCTION public.finalize_exit_settlement(_settlement_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s public.employee_settlements; v_uid uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO s FROM public.employee_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF s.status <> 'draft' THEN RAISE EXCEPTION 'Settlement is already %', s.status; END IF;

  UPDATE public.employee_settlements
     SET status = 'finalized', finalized_at = now(), finalized_by = auth.uid()
   WHERE id = _settlement_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = s.employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'general', 'Full & final settlement ready',
            'Your full & final settlement has been finalised. Net ₹' ||
            to_char(s.net_settlement, 'FM9999999990.00') || '.', '/my-hr');
  END IF;

  RETURN 'finalized';
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_exit_settlement_paid(_settlement_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s public.employee_settlements; a jsonb; ent jsonb;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO s FROM public.employee_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF s.status='paid' THEN RETURN 'paid'; END IF;
  IF s.status <> 'finalized' THEN RAISE EXCEPTION 'Settlement must be finalized before it is paid (current: %)', s.status; END IF;

  UPDATE public.employee_settlements
     SET status = 'paid', paid_at = now(), paid_by = auth.uid()
   WHERE id = _settlement_id;

  -- Recover only the reviewed advances; refuse a stale snapshot.
  FOR a IN SELECT value FROM jsonb_array_elements(s.advance_snapshot) LOOP
   UPDATE expense_advances SET recovered_amount=recovered_amount+(a->>'amount')::numeric,
    status=CASE WHEN outstanding=(a->>'amount')::numeric THEN 'recovered' ELSE status END,
    settled_at=CASE WHEN outstanding=(a->>'amount')::numeric THEN now() ELSE settled_at END
    WHERE id=(a->>'id')::uuid AND outstanding>=(a->>'amount')::numeric;
   IF NOT FOUND THEN RAISE EXCEPTION 'Advance changed after settlement calculation'; END IF;
  END LOOP;
  FOR ent IN SELECT value FROM jsonb_array_elements(s.leave_snapshot) LOOP
   UPDATE employee_leave_entitlements SET entitled_days=entitled_days-(ent->>'days')::numeric
    WHERE id=(ent->>'id')::uuid AND available_days>=(ent->>'days')::numeric;
   IF NOT FOUND THEN RAISE EXCEPTION 'Leave balance changed after settlement calculation'; END IF;
  END LOOP;

  UPDATE public.employee_exits SET settled_on = current_date WHERE id = s.exit_id;

  RETURN 'paid';
END;
$$;
REVOKE INSERT,UPDATE,DELETE ON public.employee_settlements,public.employee_settlement_lines FROM authenticated;

CREATE OR REPLACE FUNCTION public.hr_validate_field_value()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d employee_field_defs; parsed date;
BEGIN
 SELECT * INTO d FROM employee_field_defs WHERE id=NEW.field_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inactive or unknown field'; END IF;
 IF d.is_required AND COALESCE(btrim(NEW.value),'')='' THEN RAISE EXCEPTION 'Field % is required',d.label; END IF;
 IF COALESCE(btrim(NEW.value),'')='' THEN RETURN NEW; END IF;
 IF d.field_type='number' AND NEW.value !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN RAISE EXCEPTION 'Invalid number'; END IF;
 IF d.field_type='date' THEN
  IF NEW.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid date'; END IF;
  parsed:=NEW.value::date;
 END IF;
 IF d.field_type='boolean' AND NEW.value NOT IN ('true','false') THEN RAISE EXCEPTION 'Invalid boolean'; END IF;
 IF d.field_type='select' AND NOT d.options ? NEW.value THEN RAISE EXCEPTION 'Invalid option'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_validate_field_value ON public.employee_field_values;
CREATE TRIGGER hr_validate_field_value BEFORE INSERT OR UPDATE ON public.employee_field_values FOR EACH ROW EXECUTE FUNCTION public.hr_validate_field_value();
CREATE OR REPLACE FUNCTION public.set_employee_field_value(
  _employee_profile_id uuid, _field_id uuid, _value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF EXISTS(SELECT 1 FROM employee_field_defs WHERE id=_field_id AND is_required) AND COALESCE(btrim(_value),'')='' THEN RAISE EXCEPTION 'Required field cannot be cleared'; END IF;
  IF _value IS NULL OR btrim(_value) = '' THEN
    DELETE FROM public.employee_field_values
     WHERE employee_profile_id = _employee_profile_id AND field_id = _field_id;
    RETURN;
  END IF;

  INSERT INTO public.employee_field_values (employee_profile_id, field_id, value, updated_by, updated_at)
  VALUES (_employee_profile_id, _field_id, btrim(_value), auth.uid(), now())
  ON CONFLICT (employee_profile_id, field_id)
  DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
END;
$$;

DROP POLICY IF EXISTS "People read feedback about them" ON public.performance_feedback;
DROP POLICY IF EXISTS "People read feedback about them" ON public.performance_feedback;
CREATE POLICY "People read feedback about them" ON public.performance_feedback FOR SELECT TO authenticated
 USING(public.has_permission(auth.uid(),'hr:performance_manage') OR reviewer_user_id=auth.uid());
CREATE OR REPLACE FUNCTION public.my_performance_feedback()
RETURNS TABLE(id uuid,cycle_id uuid,employee_profile_id uuid,reviewer_user_id uuid,relationship text,rating numeric,comments text,is_anonymous boolean,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT f.id,f.cycle_id,f.employee_profile_id,CASE WHEN f.is_anonymous THEN NULL ELSE f.reviewer_user_id END,
 f.relationship,f.rating,f.comments,f.is_anonymous,f.created_at FROM performance_feedback f
 JOIN employee_profiles e ON e.id=f.employee_profile_id WHERE e.user_id=auth.uid() AND public.is_account_active(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.my_performance_feedback() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_performance_feedback() TO authenticated;
DROP POLICY IF EXISTS "Staff read live announcements" ON public.announcements;
DROP POLICY IF EXISTS "Staff read live announcements" ON public.announcements;
CREATE POLICY "Staff read live announcements" ON public.announcements FOR SELECT TO authenticated USING(
 public.has_permission(auth.uid(),'hr:engage_manage') OR
 (published_at<=now() AND (expires_at IS NULL OR expires_at>now())
  AND (audience_roles IS NULL OR EXISTS(SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role=ANY(announcements.audience_roles)))
  AND (campus_id IS NULL OR EXISTS(SELECT 1 FROM employee_profiles WHERE user_id=auth.uid() AND campus_id=announcements.campus_id))
  AND (institution_id IS NULL OR EXISTS(SELECT 1 FROM employee_profiles WHERE user_id=auth.uid() AND institution_id=announcements.institution_id))));
CREATE OR REPLACE FUNCTION public.reconcile_login_bans_internal()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_row   record;
  v_count integer := 0;
BEGIN
  FOR v_row IN SELECT * FROM public.login_ban_drift() LOOP
    IF v_row.should_be_banned THEN
      UPDATE auth.users
         SET banned_until = now() + interval '876000 hours'
       WHERE id = v_row.user_id;
      PERFORM public.hr_revoke_sessions_internal(v_row.user_id);
    ELSE
      UPDATE auth.users SET banned_until = NULL WHERE id = v_row.user_id;
    END IF;

    INSERT INTO public.user_admin_audit_log (
      target_user_id, target_display_name, action, details
    ) VALUES (
      v_row.user_id, v_row.display_name,
      CASE WHEN v_row.should_be_banned THEN 'login_disabled' ELSE 'login_enabled' END,
      jsonb_build_object('source', 'reconcile_login_bans_internal')
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
CREATE OR REPLACE FUNCTION public.approve_attendance_regularisation(_ids uuid[], _approve boolean, _note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_count integer := 0; v_hit integer;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:attendance_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOR r IN
    SELECT * FROM public.attendance_regularisations
     WHERE id = ANY(_ids) AND status = 'pending' FOR UPDATE
  LOOP
    IF _approve AND r.user_id IS NOT NULL THEN
      -- Correct the day's FIRST in and LAST out rather than stamping every punch
      -- row with the same time.
      IF r.requested_punch_in IS NOT NULL THEN
        UPDATE public.employee_attendance
           SET punch_in = r.requested_punch_in, notes = 'Regularised: ' || r.reason
         WHERE id = (
           SELECT id FROM public.employee_attendance
            WHERE user_id = r.user_id AND date = r.date
            ORDER BY punch_in NULLS FIRST
            LIMIT 1
         );
      END IF;

      IF r.requested_punch_out IS NOT NULL THEN
        UPDATE public.employee_attendance
           SET punch_out = r.requested_punch_out, notes = 'Regularised: ' || r.reason
         WHERE id = (
           SELECT id FROM public.employee_attendance
            WHERE user_id = r.user_id AND date = r.date
            ORDER BY punch_out DESC NULLS FIRST
            LIMIT 1
         );
      END IF;

      SELECT count(*) INTO v_hit FROM public.employee_attendance
       WHERE user_id = r.user_id AND date = r.date;

      IF v_hit = 0 THEN
        INSERT INTO public.employee_attendance (user_id, date, punch_in, punch_out, notes)
        VALUES (r.user_id, r.date, r.requested_punch_in, r.requested_punch_out,
                'Regularised: ' || r.reason);
      END IF;
    END IF;

    UPDATE public.attendance_regularisations
       SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
           reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_save_salary_structure(_structure_id uuid,_name text,_components jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid uuid:=_structure_id; c jsonb;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:payroll_run') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF COALESCE(btrim(_name),'')='' OR jsonb_typeof(_components)<>'array' THEN RAISE EXCEPTION 'Structure name and components required'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(_components) c JOIN salary_components s ON s.id=(c->>'component_id')::uuid WHERE s.kind='earning' AND s.calculation='balance')<>1 THEN RAISE EXCEPTION 'Include exactly one balance earning'; END IF;
 IF sid IS NULL THEN INSERT INTO salary_structures(name) VALUES(_name) RETURNING id INTO sid;
 ELSE UPDATE salary_structures SET name=_name,updated_at=now() WHERE id=sid; IF NOT FOUND THEN RAISE EXCEPTION 'Structure missing'; END IF; END IF;
 DELETE FROM salary_structure_components WHERE salary_structure_id=sid;
 FOR c IN SELECT value FROM jsonb_array_elements(_components) LOOP
  IF (c->>'value')::numeric<0 OR (c->>'value') IS NULL OR (c->>'value')='NaN' THEN RAISE EXCEPTION 'Component value must be nonnegative'; END IF;
  INSERT INTO salary_structure_components(salary_structure_id,component_id,value) VALUES(sid,(c->>'component_id')::uuid,(c->>'value')::numeric);
 END LOOP;
 RETURN sid;
END $$;
CREATE OR REPLACE FUNCTION public.hr_assign_salary_structure(_employee_id uuid,_structure_id uuid,_effective_from date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT has_permission(auth.uid(),'hr:payroll_run') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM salary_structures WHERE id=_structure_id AND is_active) THEN RAISE EXCEPTION 'Structure unavailable'; END IF;
 UPDATE employee_salaries SET salary_structure_id=_structure_id WHERE employee_profile_id=_employee_id AND effective_from=_effective_from;
 IF NOT FOUND THEN RAISE EXCEPTION 'Salary revision not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION hr_save_salary_structure(uuid,text,jsonb),hr_assign_salary_structure(uuid,uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_save_salary_structure(uuid,text,jsonb),hr_assign_salary_structure(uuid,uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_expected_workday(_employee_id uuid,_on date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM employee_profiles e LEFT JOIN work_shifts ws ON ws.id=e.work_shift_id
 WHERE e.id=_employee_id AND _on>=COALESCE(e.date_of_joining,_on) AND _on<=COALESCE(e.date_of_exit,_on)
 AND NOT EXTRACT(DOW FROM _on)::smallint=ANY(COALESCE(ws.weekly_offs,'{}'::smallint[]))
 AND NOT EXISTS(SELECT 1 FROM holidays h WHERE h.holiday_date=_on AND h.kind<>'restricted'
  AND(h.campus_id IS NULL OR h.campus_id=e.campus_id) AND(h.institution_id IS NULL OR h.institution_id=e.institution_id))
 AND NOT EXISTS(SELECT 1 FROM employee_leave_requests r WHERE r.employee_profile_id=e.id AND r.status='approved' AND _on BETWEEN r.start_date AND r.end_date));
$$;
REVOKE ALL ON FUNCTION hr_expected_workday(uuid,date) FROM PUBLIC,anon,authenticated;
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
      AND(e.date_of_joining IS NULL OR e.date_of_joining<=_to) AND(e.date_of_exit IS NULL OR e.date_of_exit>=_from)
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
    (SELECT count(*) FROM generate_series(_from::timestamp,_to::timestamp,interval '1 day') day
      WHERE public.hr_expected_workday(emp.id,day::date) AND NOT EXISTS(SELECT 1 FROM att a WHERE a.user_id=emp.user_id AND a.date=day::date))::bigint AS absent_days,
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
