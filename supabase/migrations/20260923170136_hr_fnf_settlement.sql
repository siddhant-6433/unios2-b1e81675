-- Full & Final (F&F) settlement.
--
-- Computes the money owed at exit — final-month salary, leave encashment and
-- gratuity, less notice recovery and outstanding advances — as an itemised,
-- snapshot statement that HR reviews before marking it paid. The calculation
-- runs in the database so it cannot drift from the leave, salary and advance
-- records it reads, and the stored lines are the record of what was paid.

-- ── Config ──────────────────────────────────────────────────────────────────

INSERT INTO public.payroll_statutory_config (legal_entity_id, key, numeric_value, note)
SELECT NULL, v.key, v.val, v.note
FROM (VALUES
  ('fnf_encashment_divisor',       26::numeric, 'Days divisor for leave encashment (gross / divisor)'),
  ('fnf_gratuity_days_per_year',   15::numeric, 'Gratuity days per completed year of service'),
  ('fnf_gratuity_min_years',        5::numeric, 'Minimum service years before gratuity is payable'),
  ('fnf_notice_recovery_divisor',  30::numeric, 'Days divisor for short-notice recovery')
) AS v(key, val, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_statutory_config c
   WHERE c.legal_entity_id IS NULL AND c.key = v.key
);

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_settlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  exit_id             uuid NOT NULL REFERENCES public.employee_exits(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'finalized', 'paid', 'cancelled')),
  last_working_day    date,
  gross_earnings      numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions    numeric(14,2) NOT NULL DEFAULT 0,
  net_settlement      numeric(14,2) NOT NULL DEFAULT 0,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  finalized_at        timestamptz,
  finalized_by        uuid REFERENCES auth.users(id),
  paid_at             timestamptz,
  paid_by             uuid REFERENCES auth.users(id),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exit_id)
);
CREATE INDEX IF NOT EXISTS employee_settlements_employee_idx
  ON public.employee_settlements (employee_profile_id, status);

CREATE TABLE IF NOT EXISTS public.employee_settlement_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.employee_settlements(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('earning', 'deduction')),
  amount        numeric(14,2) NOT NULL DEFAULT 0,
  detail        text,
  display_order integer NOT NULL DEFAULT 100
);
CREATE INDEX IF NOT EXISTS employee_settlement_lines_settlement_idx
  ON public.employee_settlement_lines (settlement_id, display_order);

ALTER TABLE public.employee_settlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_settlement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR manages settlements" ON public.employee_settlements;
CREATE POLICY "HR manages settlements"
  ON public.employee_settlements FOR ALL TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:payroll_run'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
  )
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:payroll_run'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
  );

DROP POLICY IF EXISTS "Employees read own settlement" ON public.employee_settlements;
CREATE POLICY "Employees read own settlement"
  ON public.employee_settlements FOR SELECT TO authenticated
  USING (
    status IN ('finalized', 'paid')
    AND EXISTS (SELECT 1 FROM public.employee_profiles e
                 WHERE e.id = employee_settlements.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR reads settlement lines" ON public.employee_settlement_lines;
CREATE POLICY "HR reads settlement lines"
  ON public.employee_settlement_lines FOR ALL TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:payroll_run'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
  )
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:payroll_run'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
  );

DROP POLICY IF EXISTS "Employees read own settlement lines" ON public.employee_settlement_lines;
CREATE POLICY "Employees read own settlement lines"
  ON public.employee_settlement_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_settlements s
      JOIN public.employee_profiles e ON e.id = s.employee_profile_id
      WHERE s.id = employee_settlement_lines.settlement_id
        AND s.status IN ('finalized', 'paid')
        AND e.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_settlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_settlement_lines TO authenticated;
GRANT ALL ON public.employee_settlements, public.employee_settlement_lines TO service_role;

CREATE OR REPLACE FUNCTION public.tg_settlements_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_employee_settlements_touch ON public.employee_settlements;
CREATE TRIGGER trg_employee_settlements_touch
  BEFORE UPDATE ON public.employee_settlements
  FOR EACH ROW EXECUTE FUNCTION public.tg_settlements_touch();

-- ── Config helper ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fnf_config(_key text, _default numeric)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT numeric_value FROM public.payroll_statutory_config
      WHERE key = _key AND legal_entity_id IS NULL
      ORDER BY effective_from DESC LIMIT 1),
    _default);
$$;

-- ── Compute ─────────────────────────────────────────────────────────────────

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
  v_final_days int;
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

  SELECT * INTO x FROM public.employee_exits WHERE id = _exit_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exit not found'; END IF;
  SELECT * INTO e FROM public.employee_profiles WHERE id = x.employee_profile_id;
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
  v_final_days  := v_lwd - v_month_start + 1;
  v_salary_amount := round(v_salary * v_final_days / GREATEST(v_month_days, 1));

  -- Leave encashment: available days across paid leave types for the current year.
  SELECT COALESCE(sum(ent.available_days), 0) INTO v_enc_days
    FROM public.employee_leave_entitlements ent
    JOIN public.leave_types t ON t.id = ent.leave_type_id
   WHERE ent.employee_profile_id = e.id
     AND t.is_paid
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

REVOKE EXECUTE ON FUNCTION public.compute_exit_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_exit_settlement(uuid) TO authenticated, service_role;

-- ── Finalize / pay ──────────────────────────────────────────────────────────

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

  SELECT * INTO s FROM public.employee_settlements WHERE id = _settlement_id;
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

REVOKE EXECUTE ON FUNCTION public.finalize_exit_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_exit_settlement(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_exit_settlement_paid(_settlement_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s public.employee_settlements;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO s FROM public.employee_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF s.status <> 'finalized' THEN RAISE EXCEPTION 'Settlement must be finalized before it is paid (current: %)', s.status; END IF;

  UPDATE public.employee_settlements
     SET status = 'paid', paid_at = now(), paid_by = auth.uid()
   WHERE id = _settlement_id;

  -- Clear outstanding advances for this employee — they were netted off.
  UPDATE public.expense_advances
     SET recovered_amount = amount, status = 'recovered', settled_at = now()
   WHERE employee_profile_id = s.employee_profile_id AND status = 'open';

  UPDATE public.employee_exits SET settled_on = current_date WHERE id = s.exit_id;

  RETURN 'paid';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_exit_settlement_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_exit_settlement_paid(uuid) TO authenticated, service_role;

-- ── View ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.employee_settlements_inbox AS
SELECT
  s.id, s.employee_profile_id, s.exit_id, s.status, s.last_working_day,
  s.gross_earnings, s.total_deductions, s.net_settlement,
  s.computed_at, s.finalized_at, s.paid_at, s.note,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  e.employee_number, e.job_title,
  x.exit_type
FROM public.employee_settlements s
JOIN public.employee_profiles e ON e.id = s.employee_profile_id
LEFT JOIN public.employee_exits x ON x.id = s.exit_id;

ALTER VIEW public.employee_settlements_inbox SET (security_invoker = true);
GRANT SELECT ON public.employee_settlements_inbox TO authenticated, service_role;
