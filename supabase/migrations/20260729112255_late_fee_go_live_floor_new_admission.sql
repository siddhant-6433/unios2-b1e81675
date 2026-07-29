-- Late-fee go-live floor + new-admission scoping.
--   accrual_start_date: fines never accrue for days before this date, so enabling the
--     engine does NOT backdate to April — it accrues forward from go-live.
--   Scope: only NIMT Beacon 'new_admission' structures are activated. 'existing_parent'
--     (imported) students are left dormant because their fee collection lives on the
--     legacy system (not yet migrated) — their ledger "unpaid" is not authoritative.

ALTER TABLE public.late_fee_policies
  ADD COLUMN IF NOT EXISTS accrual_start_date date;

-- Recompute, now flooring accrual at GREATEST(due_date + grace, accrual_start_date).
CREATE OR REPLACE FUNCTION public.fn_recompute_late_fees(_student_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_late uuid; rec record; v_rate numeric; v_eff date; v_start date; v_days int; v_amt numeric;
  v_late_term text; v_existing uuid;
BEGIN
  SELECT id INTO v_late FROM public.fee_codes WHERE code = 'LATE-FEE' LIMIT 1;
  IF v_late IS NULL THEN RETURN; END IF;

  FOR rec IN
    SELECT fl.id AS ledger_id, fl.student_id, fl.term, fl.due_date, fl.updated_at,
           (fl.total_amount - fl.concession - fl.paid_amount) AS balance,
           lfp.penalty_amount, lfp.boarding_penalty_amount, lfp.boarding_fee_codes,
           COALESCE(lfp.grace_period_days, 0) AS grace, lfp.max_penalty_cap,
           lfp.accrual_start_date
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
    IF EXISTS (
      SELECT 1 FROM public.fee_ledger b JOIN public.fee_codes bc ON bc.id = b.fee_code_id
       WHERE b.student_id = rec.student_id AND bc.code = ANY (rec.boarding_fee_codes)
    ) THEN
      v_rate := rec.boarding_penalty_amount;
    ELSE
      v_rate := rec.penalty_amount;
    END IF;

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

    -- accrual starts the later of (due date + grace) and the go-live floor
    v_start := rec.due_date + rec.grace;
    IF rec.accrual_start_date IS NOT NULL AND rec.accrual_start_date > v_start THEN
      v_start := rec.accrual_start_date;
    END IF;
    v_days := GREATEST(0, v_eff - v_start);
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
        UPDATE public.fee_ledger SET total_amount = v_amt, updated_at = now()
         WHERE id = v_existing AND paid_amount = 0;
      END IF;
    ELSE
      DELETE FROM public.fee_ledger WHERE id = v_existing AND paid_amount = 0;
    END IF;
  END LOOP;
END;
$function$;

-- Activate ONLY Beacon new_admission policies, go-live floored at today (2026-07-29).
-- existing_parent / standard (imported) policies stay is_active = false.
UPDATE public.late_fee_policies lfp
   SET is_active = true, accrual_start_date = DATE '2026-07-29', updated_at = now()
  FROM public.fee_structures fs
 WHERE fs.id = lfp.fee_structure_id
   AND lfp.penalty_amount = 25 AND lfp.boarding_penalty_amount = 100
   AND fs.version = 'new_admission';
