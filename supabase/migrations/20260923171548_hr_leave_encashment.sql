-- Leave encashment.
--
-- Employees request to cash out unused paid leave; HR approves; payroll pays it.
-- Paying reduces entitled_days (not used_days), because used_days is recomputed
-- from approved leave requests and would erase an encashment recorded there.

INSERT INTO public.payroll_statutory_config (legal_entity_id, key, numeric_value, note)
SELECT NULL, 'leave_encashment_divisor', 26, 'Days divisor for leave encashment (gross / divisor)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_statutory_config c
   WHERE c.legal_entity_id IS NULL AND c.key = 'leave_encashment_divisor'
);

CREATE TABLE IF NOT EXISTS public.leave_encashments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  leave_type_id       uuid REFERENCES public.leave_types(id) ON DELETE SET NULL,
  leave_year          integer NOT NULL,
  days                numeric(6,2) NOT NULL CHECK (days > 0),
  amount              numeric(14,2) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'approved', 'rejected', 'paid', 'cancelled')),
  requested_by        uuid REFERENCES auth.users(id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  decided_by          uuid REFERENCES auth.users(id),
  decided_at          timestamptz,
  decision_note       text,
  payroll_cycle_id    uuid REFERENCES public.payroll_cycles(id) ON DELETE SET NULL,
  paid_at             timestamptz,
  paid_by             uuid REFERENCES auth.users(id),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_encashments_employee_idx
  ON public.leave_encashments (employee_profile_id, status);
CREATE INDEX IF NOT EXISTS leave_encashments_requested_idx
  ON public.leave_encashments (status) WHERE status = 'requested';

ALTER TABLE public.leave_encashments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "People read own encashments" ON public.leave_encashments;
CREATE POLICY "People read own encashments"
  ON public.leave_encashments FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:leave_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = leave_encashments.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR manages encashments" ON public.leave_encashments;
CREATE POLICY "HR manages encashments"
  ON public.leave_encashments FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_encashments TO authenticated;
GRANT ALL ON public.leave_encashments TO service_role;

CREATE OR REPLACE FUNCTION public.tg_leave_encashments_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_leave_encashments_touch ON public.leave_encashments;
CREATE TRIGGER trg_leave_encashments_touch
  BEFORE UPDATE ON public.leave_encashments
  FOR EACH ROW EXECUTE FUNCTION public.tg_leave_encashments_touch();

-- ── RPCs ────────────────────────────────────────────────────────────────────

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

  SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = auth.uid();
  IF v_profile IS NULL THEN RAISE EXCEPTION 'No employee record for this user'; END IF;

  SELECT ent.available_days INTO v_available
    FROM public.employee_leave_entitlements ent
   WHERE ent.employee_profile_id = v_profile
     AND ent.leave_type_id = _leave_type_id
     AND ent.leave_year = v_year;
  IF v_available IS NULL THEN RAISE EXCEPTION 'No leave balance for that type/year'; END IF;
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

REVOKE EXECUTE ON FUNCTION public.request_leave_encashment(uuid, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_leave_encashment(uuid, numeric, integer, text) TO authenticated, service_role;

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

  SELECT * INTO enc FROM public.leave_encashments WHERE id = _encashment_id;
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

REVOKE EXECUTE ON FUNCTION public.decide_leave_encashment(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_leave_encashment(uuid, boolean, text) TO authenticated, service_role;

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

  SELECT * INTO enc FROM public.leave_encashments WHERE id = _encashment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encashment not found'; END IF;
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

REVOKE EXECUTE ON FUNCTION public.pay_leave_encashment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_leave_encashment(uuid, uuid) TO authenticated, service_role;

-- ── Self-service leave balances (entitlements engine) ───────────────────────

CREATE OR REPLACE FUNCTION public.my_leave_balances()
RETURNS TABLE (
  leave_type_id uuid, leave_type text, leave_year integer,
  entitled numeric, carried_forward numeric, used numeric, available numeric
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
  SELECT ent.leave_type_id,
         COALESCE(t.name, t.code),
         ent.leave_year, ent.entitled_days, ent.carried_forward, ent.used_days, ent.available_days
    FROM public.employee_leave_entitlements ent
    JOIN public.leave_types t ON t.id = ent.leave_type_id
   WHERE ent.employee_profile_id = v_profile
   ORDER BY ent.leave_year DESC, t.display_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_leave_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_leave_balances() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.leave_encashments_inbox AS
SELECT
  le.id, le.employee_profile_id, le.leave_type_id, le.leave_year, le.days, le.amount,
  le.status, le.requested_at, le.decided_at, le.decision_note, le.payroll_cycle_id, le.paid_at,
  COALESCE(t.name, t.code) AS leave_type,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  e.employee_number
FROM public.leave_encashments le
LEFT JOIN public.leave_types t ON t.id = le.leave_type_id
JOIN public.employee_profiles e ON e.id = le.employee_profile_id;

ALTER VIEW public.leave_encashments_inbox SET (security_invoker = true);
GRANT SELECT ON public.leave_encashments_inbox TO authenticated, service_role;
