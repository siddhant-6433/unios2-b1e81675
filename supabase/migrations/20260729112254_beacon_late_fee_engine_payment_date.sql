-- NIMT Beacon late-fee engine: per-boarding-tier daily rate, no grace, recomputed to
-- the payment date (not the receipt-entry date). Idempotent recompute replaces the old
-- insert-once generator.
--   Rate: student with a residential boarding head (NB-NAC/CBA/IBA) → ₹100/day,
--         else (day scholar or NB-DBA day-boarding) → ₹25/day.
--   Basis: fine = rate × days from due_date to the effective date, no grace.
--          effective date = today while the quarter is unpaid; once paid it freezes to
--          the payment_date of the receipt that cleared it (linked via fee_ledger_payments),
--          falling back to when the ledger was last updated if no link exists.
--   Scope: one fine per overdue quarter, anchored on the tuition head. Beacon only.

-- 1. Extend the policy with the boarding-tier rate + which fee codes count as residential.
ALTER TABLE public.late_fee_policies
  ADD COLUMN IF NOT EXISTS boarding_penalty_amount numeric,
  ADD COLUMN IF NOT EXISTS boarding_fee_codes text[];

-- 2. One active policy per Beacon (NB-*) structure in 2026-27: ₹25 base / ₹100 boarding,
--    daily, zero grace, applies to tuition. Idempotent (skip structures already policied).
INSERT INTO public.late_fee_policies
  (fee_structure_id, grace_period_days, penalty_type, penalty_amount,
   boarding_penalty_amount, boarding_fee_codes, applies_to_categories, is_active)
SELECT DISTINCT fs.id, 0, 'daily', 25, 100,
       ARRAY['NB-NAC','NB-CBA','NB-IBA'], ARRAY['tuition'], true
FROM public.fee_structures fs
WHERE fs.session_id = 'f0000001-0000-0000-0000-000000000001'
  AND EXISTS (SELECT 1 FROM public.fee_structure_items fsi
                JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
               WHERE fsi.fee_structure_id = fs.id AND fc.code LIKE 'NB-%')
  AND NOT EXISTS (SELECT 1 FROM public.late_fee_policies p WHERE p.fee_structure_id = fs.id);

-- 3. Idempotent recompute. _student_id NULL = all students (daily cron); non-null = one
--    student (called right after an offline receipt so the fine reflects the payment date).
CREATE OR REPLACE FUNCTION public.fn_recompute_late_fees(_student_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_late uuid; rec record; v_rate numeric; v_eff date; v_days int; v_amt numeric;
  v_late_term text; v_existing uuid;
BEGIN
  SELECT id INTO v_late FROM public.fee_codes WHERE code = 'LATE-FEE' LIMIT 1;
  IF v_late IS NULL THEN RETURN; END IF;

  FOR rec IN
    SELECT fl.id AS ledger_id, fl.student_id, fl.term, fl.due_date, fl.updated_at,
           (fl.total_amount - fl.concession - fl.paid_amount) AS balance,
           lfp.penalty_amount, lfp.boarding_penalty_amount, lfp.boarding_fee_codes,
           COALESCE(lfp.grace_period_days, 0) AS grace, lfp.max_penalty_cap
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
    JOIN public.students s ON s.id = fl.student_id
    JOIN public.fee_structures fs
        ON fs.course_id = s.course_id AND fs.session_id = s.session_id
       AND fs.version = s.fee_structure_version
    JOIN public.late_fee_policies lfp
        ON lfp.fee_structure_id = fs.id AND lfp.is_active = true
       AND fc.category = ANY (lfp.applies_to_categories)
    WHERE fl.fee_code_id <> v_late
      AND fl.due_date IS NOT NULL
      AND (_student_id IS NULL OR fl.student_id = _student_id)
  LOOP
    -- rate by boarding tier: residential boarding head present → boarding rate
    IF EXISTS (
      SELECT 1 FROM public.fee_ledger b JOIN public.fee_codes bc ON bc.id = b.fee_code_id
       WHERE b.student_id = rec.student_id AND bc.code = ANY (rec.boarding_fee_codes)
    ) THEN
      v_rate := rec.boarding_penalty_amount;
    ELSE
      v_rate := rec.penalty_amount;
    END IF;

    -- effective date: unpaid → today; paid → payment_date of the linked receipt(s),
    -- else the ledger's last-updated date.
    IF rec.balance <= 0 THEN
      v_eff := COALESCE(
        (SELECT MAX(lp.payment_date)
           FROM public.fee_ledger_payments flp
           JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
          WHERE flp.fee_ledger_id = rec.ledger_id
            AND lp.status = 'confirmed' AND lp.payment_date IS NOT NULL),
        rec.updated_at::date);
    ELSE
      v_eff := CURRENT_DATE;
    END IF;

    v_days := GREATEST(0, (v_eff - rec.due_date) - rec.grace);
    v_amt  := ROUND(COALESCE(v_rate, 0) * v_days, 2);
    IF rec.max_penalty_cap IS NOT NULL THEN v_amt := LEAST(v_amt, rec.max_penalty_cap); END IF;

    v_late_term := 'late_' || rec.term;
    SELECT id INTO v_existing FROM public.fee_ledger
     WHERE student_id = rec.student_id AND term = v_late_term AND fee_code_id = v_late
     LIMIT 1;

    IF v_amt > 0 THEN
      IF v_existing IS NULL THEN
        INSERT INTO public.fee_ledger
          (student_id, fee_code_id, fee_structure_item_id, term, total_amount, due_date, status)
        VALUES (rec.student_id, v_late, NULL, v_late_term, v_amt, CURRENT_DATE, 'due');
      ELSE
        -- never reduce a late fee that has already been (partly) paid
        UPDATE public.fee_ledger SET total_amount = v_amt, updated_at = now()
         WHERE id = v_existing AND paid_amount = 0;
      END IF;
    ELSE
      -- no fine owed → clear a stale unpaid late-fee row
      DELETE FROM public.fee_ledger WHERE id = v_existing AND paid_amount = 0;
    END IF;
  END LOOP;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_recompute_late_fees(uuid) TO authenticated, service_role;

-- 4. Repoint the daily generator at the idempotent recompute (cron job 29 calls this name).
CREATE OR REPLACE FUNCTION public.fn_generate_late_fees()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_recompute_late_fees(NULL);
END;
$function$;

-- 5. Link head-targeted credit application to its source receipt so the payment_date
--    attributes to the head (drives the payment-date freeze above). Adds a trailing
--    optional _source_payment_id; existing named callers are unaffected.
DROP FUNCTION IF EXISTS public.apply_student_credit(uuid,uuid,numeric,text);
CREATE OR REPLACE FUNCTION public.apply_student_credit(
  _id uuid, _fee_ledger_id uuid DEFAULT NULL, _amount numeric DEFAULT NULL,
  _reason text DEFAULT NULL, _source_payment_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_student uuid; v_form uuid; v_credit numeric; v_budget numeric;
  v_applied numeric := 0; v_row RECORD; v_apply numeric; v_before numeric;
  v_actor uuid := auth.uid(); v_role text;
BEGIN
  SELECT s.id, s.lead_id INTO v_student, v_lead FROM public.students s WHERE s.id = _id OR s.lead_id = _id LIMIT 1;
  IF v_student IS NULL THEN RETURN jsonb_build_object('error', 'no student for id', 'applied', 0); END IF;
  SELECT id INTO v_form FROM public.fee_codes WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor
   ORDER BY (CASE WHEN role::text = 'super_admin' THEN 0 ELSE 1 END) LIMIT 1;
  PERFORM 1 FROM public.fee_ledger WHERE student_id = v_student FOR UPDATE;
  v_credit := (public.student_fee_credit_balance(v_lead) ->> 'general_credit')::numeric;
  v_budget := LEAST(COALESCE(_amount, v_credit), v_credit);
  IF COALESCE(v_budget,0) <= 0 THEN
    RETURN jsonb_build_object('applied', 0, 'available_credit', COALESCE(v_credit,0), 'note', 'no credit available'); END IF;
  FOR v_row IN
    SELECT fl.id, fl.total_amount, fl.concession, fl.paid_amount, fl.due_date, fl.status, fc.code, fl.term
      FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.student_id = v_student AND fl.fee_code_id IS DISTINCT FROM v_form
       AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
       AND (_fee_ledger_id IS NULL OR fl.id = _fee_ledger_id)
     ORDER BY
       CASE WHEN UPPER(fc.code) LIKE '%SEC' THEN 1 WHEN fl.term = 'admission' THEN 0 ELSE 2 END,
       fl.due_date NULLS LAST, fl.term, fc.code, fl.id
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
    -- attribute this application to the source receipt (enables payment-date late-fine freeze)
    IF _source_payment_id IS NOT NULL THEN
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, applied_at)
      VALUES (v_row.id, _source_payment_id, v_apply, now());
    END IF;
    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, to_fee_ledger_id, to_fee_code, to_term, amount, reason,
       actor_user_id, actor_role, before_json, after_json)
    VALUES (v_student, 'apply_credit', v_row.id, v_row.code, v_row.term, v_apply,
       COALESCE(NULLIF(btrim(_reason), ''), 'Credit applied'), v_actor, v_role,
       jsonb_build_object('paid_amount', v_before), jsonb_build_object('paid_amount', v_before + v_apply));
    v_budget := v_budget - v_apply; v_applied := v_applied + v_apply;
  END LOOP;
  -- refresh this student's late fines to reflect the new payment (payment-date basis)
  PERFORM public.fn_recompute_late_fees(v_student);
  RETURN jsonb_build_object('applied', v_applied,
    'remaining_credit', (public.student_fee_credit_balance(v_lead) ->> 'general_credit')::numeric);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.apply_student_credit(uuid,uuid,numeric,text,uuid) TO authenticated, service_role;
