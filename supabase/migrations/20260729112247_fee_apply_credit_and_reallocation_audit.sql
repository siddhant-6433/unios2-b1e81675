-- Fee-module hardening, step 2: reallocation audit table + apply_student_credit.
-- Credit is derived (payments − paid); applying it just increments fee_ledger.paid_amount
-- on the target heads and records a reason-bearing audit row. Apply order for a student:
-- admission fee first, security deposit second, then the rest by due date. The earmarked
-- application-fee head (FORM-FEE) is never funded by general credit.

-- 1. Shared audit for money movement (apply-credit, transfer, unapply-to-credit).
CREATE TABLE IF NOT EXISTS public.fee_ledger_reallocation_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid,
  action             text NOT NULL CHECK (action IN ('apply_credit','transfer','unapply_to_credit')),
  from_fee_ledger_id uuid,          -- null = from credit
  to_fee_ledger_id   uuid,          -- null = to credit
  from_fee_code      text,
  from_term          text,
  to_fee_code        text,
  to_term            text,
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  reason             text,
  actor_user_id      uuid,
  actor_role         text,
  before_json        jsonb,
  after_json         jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_realloc_audit_student ON public.fee_ledger_reallocation_audit(student_id, created_at DESC);

ALTER TABLE public.fee_ledger_reallocation_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance reads fee reallocation audit" ON public.fee_ledger_reallocation_audit;
CREATE POLICY "finance reads fee reallocation audit" ON public.fee_ledger_reallocation_audit
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'accountant')
    OR public.has_role(auth.uid(),'campus_admin') OR public.has_role(auth.uid(),'principal'));
GRANT SELECT ON public.fee_ledger_reallocation_audit TO authenticated, service_role;

-- 2. apply_student_credit: post general credit onto a student's heads.
--    _fee_ledger_id given → that head only; else auto (admission → deposit → due date).
--    _amount caps the spend; null = up to available credit.
CREATE OR REPLACE FUNCTION public.apply_student_credit(
  _id uuid,
  _fee_ledger_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead    uuid;
  v_student uuid;
  v_form    uuid;
  v_credit  numeric;
  v_budget  numeric;
  v_applied numeric := 0;
  v_row     RECORD;
  v_apply   numeric;
  v_before  numeric;
  v_actor   uuid := auth.uid();
  v_role    text;
BEGIN
  SELECT s.id, s.lead_id INTO v_student, v_lead
    FROM public.students s WHERE s.id = _id OR s.lead_id = _id LIMIT 1;
  IF v_student IS NULL THEN
    RETURN jsonb_build_object('error', 'no student for id', 'applied', 0);
  END IF;

  SELECT id INTO v_form FROM public.fee_codes
   WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor
   ORDER BY (CASE WHEN role::text = 'super_admin' THEN 0 ELSE 1 END) LIMIT 1;

  -- Lock the student's heads, then compute available credit inside the lock.
  PERFORM 1 FROM public.fee_ledger WHERE student_id = v_student FOR UPDATE;
  v_credit := (public.student_fee_credit_balance(v_lead) ->> 'general_credit')::numeric;
  v_budget := LEAST(COALESCE(_amount, v_credit), v_credit);
  IF COALESCE(v_budget,0) <= 0 THEN
    RETURN jsonb_build_object('applied', 0, 'available_credit', COALESCE(v_credit,0), 'note', 'no credit available');
  END IF;

  FOR v_row IN
    SELECT fl.id, fl.total_amount, fl.concession, fl.paid_amount, fl.due_date, fl.status, fc.code, fl.term
      FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.student_id = v_student
       AND fl.fee_code_id IS DISTINCT FROM v_form
       AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
       AND (_fee_ledger_id IS NULL OR fl.id = _fee_ledger_id)
     ORDER BY
       CASE WHEN UPPER(fc.code) LIKE '%SEC' THEN 1
            WHEN fl.term = 'admission'      THEN 0
            ELSE 2 END,
       fl.due_date, fl.id
  LOOP
    EXIT WHEN v_budget <= 0;
    v_apply := LEAST(v_budget, v_row.total_amount - v_row.concession - v_row.paid_amount);
    IF v_apply <= 0 THEN CONTINUE; END IF;
    v_before := v_row.paid_amount;

    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_apply,
           status = CASE WHEN (total_amount - concession - (paid_amount + v_apply)) <= 0 THEN 'paid'
                         WHEN status = 'overdue' THEN 'overdue' ELSE 'due' END,
           updated_at = now()
     WHERE id = v_row.id;

    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, to_fee_ledger_id, to_fee_code, to_term, amount, reason,
       actor_user_id, actor_role, before_json, after_json)
    VALUES (v_student, 'apply_credit', v_row.id, v_row.code, v_row.term, v_apply,
       COALESCE(NULLIF(btrim(_reason), ''), 'Credit applied'),
       v_actor, v_role,
       jsonb_build_object('paid_amount', v_before),
       jsonb_build_object('paid_amount', v_before + v_apply));

    v_budget  := v_budget  - v_apply;
    v_applied := v_applied + v_apply;
  END LOOP;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'remaining_credit', (public.student_fee_credit_balance(v_lead) ->> 'general_credit')::numeric
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_student_credit(uuid, uuid, numeric, text) TO authenticated, service_role;
