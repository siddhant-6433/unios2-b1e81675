-- Payroll: payslips + automatic LOP / reimbursement adjustments.
--
-- The foundation deliberately shipped no self-service read ("payslip visibility
-- gets its own narrower path when payslips ship"). This is that path, plus the
-- two things payroll was missing to reconcile with leave and expenses:
--   * LOP days from approved unpaid leave in the period
--   * approved-but-unreimbursed expense claims as ad-hoc earnings
-- Both are applied in the database so the numbers cannot drift from the source.

-- ── Apply leave/expense adjustments to an open cycle ────────────────────────

CREATE OR REPLACE FUNCTION public.apply_payroll_adjustments(_cycle_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.payroll_cycles;
  l record;
  v_lop numeric;
  v_exp numeric;
  v_count integer := 0;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:payroll_run') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO c FROM public.payroll_cycles WHERE id = _cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll cycle not found'; END IF;
  IF c.status IN ('locked', 'paid') THEN RAISE EXCEPTION 'Payroll cycle is %', c.status; END IF;

  FOR l IN SELECT id, employee_profile_id FROM public.payroll_lines WHERE payroll_cycle_id = _cycle_id LOOP
    v_lop := public.employee_lop_days(l.employee_profile_id, c.period_start, c.period_end);

    SELECT COALESCE(sum(x.amount), 0) INTO v_exp
      FROM public.expense_claims x
     WHERE x.employee_profile_id = l.employee_profile_id
       AND x.status = 'approved'
       AND x.expense_date BETWEEN c.period_start AND c.period_end;

    UPDATE public.payroll_lines
       SET lop_days = v_lop,
           adhoc_earnings = v_exp
     WHERE id = l.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_payroll_adjustments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_payroll_adjustments(uuid) TO authenticated, service_role;

-- ── Payslip read RPCs (self + payroll admin) ────────────────────────────────
-- Only released cycles (locked/paid) are visible — a draft run is working data.

CREATE OR REPLACE FUNCTION public.my_payslips()
RETURNS TABLE (
  line_id uuid, cycle_id uuid, cycle_name text, period_start date, period_end date,
  status text, monthly_gross numeric, total_days numeric, payable_days numeric,
  lop_days numeric, gross_earnings numeric, total_deductions numeric,
  employer_cost numeric, net_pay numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = auth.uid();
  IF v_profile IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT pl.id, c.id,
         COALESCE(c.name, to_char(c.period_start, 'Mon YYYY')),
         c.period_start, c.period_end, c.status,
         pl.monthly_gross, pl.total_days, pl.payable_days, pl.lop_days,
         pl.gross_earnings, pl.total_deductions, pl.employer_cost, pl.net_pay
    FROM public.payroll_lines pl
    JOIN public.payroll_cycles c ON c.id = pl.payroll_cycle_id
   WHERE pl.employee_profile_id = v_profile
     AND c.status IN ('locked', 'paid')
   ORDER BY c.period_start DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_payslips() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payslips() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payslip_detail(_line_id uuid)
RETURNS TABLE (
  component_code text, component_name text, kind text, amount numeric, display_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile uuid; v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT pl.employee_profile_id INTO v_profile FROM public.payroll_lines pl WHERE pl.id = _line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payslip not found'; END IF;

  v_ok := public.has_permission(auth.uid(), 'hr:payroll_run')
          OR EXISTS (SELECT 1 FROM public.employee_profiles e
                      WHERE e.id = v_profile AND e.user_id = auth.uid());
  IF NOT v_ok THEN RAISE EXCEPTION 'Forbidden'; END IF;

  RETURN QUERY
  SELECT lc.component_code, lc.component_name, lc.kind, lc.amount, lc.display_order
    FROM public.payroll_line_components lc
   WHERE lc.payroll_line_id = _line_id
   ORDER BY lc.display_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.payslip_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payslip_detail(uuid) TO authenticated, service_role;

-- ── RLS backstop for direct reads ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS payroll_lines_employee_idx
  ON public.payroll_lines (employee_profile_id);

DROP POLICY IF EXISTS "Employees read own released cycles" ON public.payroll_cycles;
CREATE POLICY "Employees read own released cycles"
  ON public.payroll_cycles FOR SELECT TO authenticated
  USING (
    status IN ('locked', 'paid')
    AND EXISTS (
      SELECT 1 FROM public.payroll_lines pl
      JOIN public.employee_profiles e ON e.id = pl.employee_profile_id
      WHERE pl.payroll_cycle_id = payroll_cycles.id AND e.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employees read own released payslips" ON public.payroll_lines;
CREATE POLICY "Employees read own released payslips"
  ON public.payroll_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_profiles e
      WHERE e.id = payroll_lines.employee_profile_id AND e.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.payroll_cycles c
      WHERE c.id = payroll_lines.payroll_cycle_id AND c.status IN ('locked', 'paid')
    )
  );

DROP POLICY IF EXISTS "Employees read own payslip components" ON public.payroll_line_components;
CREATE POLICY "Employees read own payslip components"
  ON public.payroll_line_components FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_lines pl
      JOIN public.employee_profiles e ON e.id = pl.employee_profile_id
      WHERE pl.id = payroll_line_components.payroll_line_id AND e.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.payroll_lines pl2
      JOIN public.payroll_cycles c ON c.id = pl2.payroll_cycle_id
      WHERE pl2.id = payroll_line_components.payroll_line_id AND c.status IN ('locked', 'paid')
    )
  );
