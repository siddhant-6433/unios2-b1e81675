-- Fix: apply_student_credit picked a random head when two heads shared a due_date.
-- Original tiebreak fell through to fl.id (a random UUID), so e.g. TUITION-Y1 and
-- TUITION-Y2 (both due 01 Apr) could apply to Year 2 first. Add a deterministic
-- term/code tiebreak before fl.id so the earliest term wins on a due-date tie.
-- Only the ORDER BY changes; the rest is unchanged from
-- 20260728130724_fee_apply_credit_and_reallocation_audit.sql.
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
       fl.due_date NULLS LAST,
       fl.term,          -- deterministic on a due-date tie (year_1 < year_2, q1 < q2)
       fc.code,
       fl.id
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
