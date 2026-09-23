-- HR expense advances (salary advances / imprest).
--
-- An advance is money paid before the expense: issued to an employee, later
-- recovered from payroll or at full-and-final settlement. It is deliberately
-- separate from `expense_claims` (which reimburses money already spent) but
-- shares the same approval inbox and permissions.

CREATE TABLE IF NOT EXISTS public.expense_advances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  recovered_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
  -- Outstanding is derived so a partial recovery cannot leave the two out of step.
  outstanding         numeric(14,2) GENERATED ALWAYS AS (GREATEST(amount - recovered_amount, 0)) STORED,
  issued_on           date NOT NULL DEFAULT CURRENT_DATE,
  purpose             text,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'recovered', 'cancelled')),
  payroll_cycle_id    uuid REFERENCES public.payroll_cycles(id) ON DELETE SET NULL,
  settled_at          timestamptz,
  notes               text,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expense_advances_employee_idx
  ON public.expense_advances (employee_profile_id, status);
CREATE INDEX IF NOT EXISTS expense_advances_open_idx
  ON public.expense_advances (status) WHERE status = 'open';

ALTER TABLE public.expense_advances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own advances" ON public.expense_advances;
CREATE POLICY "Employees read own advances"
  ON public.expense_advances FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:expenses_manage'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = expense_advances.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR manages advances" ON public.expense_advances;
CREATE POLICY "HR manages advances"
  ON public.expense_advances FOR ALL TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:expenses_manage'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
  )
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:expenses_manage'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_advances TO authenticated;
GRANT ALL ON public.expense_advances TO service_role;

CREATE OR REPLACE FUNCTION public.tg_expense_advances_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_expense_advances_touch ON public.expense_advances;
CREATE TRIGGER trg_expense_advances_touch
  BEFORE UPDATE ON public.expense_advances
  FOR EACH ROW EXECUTE FUNCTION public.tg_expense_advances_touch();

-- ── RPCs ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_advance(
  _employee_profile_id uuid, _amount numeric, _purpose text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_uid uuid; v_name text;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:expenses_manage')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Advance amount must be positive'; END IF;

  INSERT INTO public.expense_advances (employee_profile_id, amount, purpose, created_by)
  VALUES (_employee_profile_id, _amount, _purpose, auth.uid())
  RETURNING id INTO v_id;

  SELECT user_id, COALESCE(NULLIF(btrim(display_name), ''), 'employee')
    INTO v_uid, v_name
    FROM public.employee_profiles WHERE id = _employee_profile_id;

  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'general', 'Advance issued',
            'An advance of ₹' || to_char(_amount, 'FM9999999990.00') ||
            COALESCE(' for ' || _purpose, '') || ' has been issued to you.', '/my-hr');
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_advance(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_advance(uuid, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.settle_advance(
  _advance_id uuid, _amount numeric, _payroll_cycle_id uuid DEFAULT NULL, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a public.expense_advances; v_new numeric; v_uid uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:expenses_approve')
          OR public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Recovery amount must be positive'; END IF;

  SELECT * INTO a FROM public.expense_advances WHERE id = _advance_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Advance not found'; END IF;
  IF a.status <> 'open' THEN RAISE EXCEPTION 'Advance is already %', a.status; END IF;

  v_new := LEAST(a.amount, a.recovered_amount + _amount);

  UPDATE public.expense_advances
     SET recovered_amount = v_new,
         status = CASE WHEN v_new >= a.amount THEN 'recovered' ELSE 'open' END,
         settled_at = CASE WHEN v_new >= a.amount THEN now() ELSE settled_at END,
         payroll_cycle_id = COALESCE(_payroll_cycle_id, payroll_cycle_id),
         notes = COALESCE(_note, notes)
   WHERE id = _advance_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = a.employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'general', 'Advance recovered',
            '₹' || to_char(_amount, 'FM9999999990.00') || ' recovered against your advance.', '/my-hr');
  END IF;

  RETURN CASE WHEN v_new >= a.amount THEN 'recovered' ELSE 'partially_recovered' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_advance(uuid, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_advance(uuid, numeric, uuid, text) TO authenticated, service_role;

-- Recover every open advance for employees on a payroll cycle, as ad-hoc
-- deductions. Idempotent: it SETS the deduction to the current outstanding total.
CREATE OR REPLACE FUNCTION public.recover_advances_for_cycle(_cycle_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c public.payroll_cycles; l record; v_total numeric; v_count integer := 0;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:payroll_run') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT * INTO c FROM public.payroll_cycles WHERE id = _cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll cycle not found'; END IF;
  IF c.status IN ('locked', 'paid') THEN RAISE EXCEPTION 'Payroll cycle is %', c.status; END IF;

  FOR l IN SELECT id, employee_profile_id FROM public.payroll_lines WHERE payroll_cycle_id = _cycle_id LOOP
    SELECT COALESCE(sum(outstanding), 0) INTO v_total
      FROM public.expense_advances
     WHERE employee_profile_id = l.employee_profile_id AND status = 'open';

    UPDATE public.payroll_lines SET adhoc_deductions = v_total WHERE id = l.id;
    IF v_total > 0 THEN v_count := v_count + 1; END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recover_advances_for_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recover_advances_for_cycle(uuid) TO authenticated, service_role;

-- ── View ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.expense_advances_inbox AS
SELECT
  a.id, a.employee_profile_id, a.amount, a.recovered_amount, a.outstanding,
  a.issued_on, a.purpose, a.status, a.payroll_cycle_id, a.settled_at, a.notes,
  a.created_at, a.updated_at,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  e.employee_number
FROM public.expense_advances a
JOIN public.employee_profiles e ON e.id = a.employee_profile_id;

ALTER VIEW public.expense_advances_inbox SET (security_invoker = true);
GRANT SELECT ON public.expense_advances_inbox TO authenticated, service_role;

COMMENT ON TABLE public.expense_advances IS
  'Employee advances (imprest/salary advances). Outstanding is derived; recovered via payroll or full-and-final settlement.';
