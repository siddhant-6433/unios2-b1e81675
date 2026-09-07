-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260903142732 name=20260903142631_fix_late_fee_frozen_when_partially_paid applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.fn_recompute_late_fees(_student_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_late uuid; rec record; v_rate numeric; v_eff date; v_days int; v_amt numeric;
  v_late_term text; v_existing uuid; v_cfg jsonb; v_grace int; v_cap numeric;
BEGIN
  SELECT id INTO v_late FROM public.fee_codes WHERE code = 'LATE-FEE' LIMIT 1;
  IF v_late IS NULL THEN RETURN; END IF;

  FOR rec IN
    SELECT fl.id AS ledger_id, fl.student_id, fl.term, fl.due_date, fl.updated_at,
           fl.late_fee_config AS cfg,
           (fl.total_amount - fl.concession - fl.paid_amount) AS balance,
           lfp.penalty_amount, lfp.boarding_penalty_amount, lfp.boarding_fee_codes,
           COALESCE(lfp.grace_period_days, 0) AS grace, lfp.max_penalty_cap
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
    JOIN public.students s ON s.id = fl.student_id
    LEFT JOIN public.fee_structures fs
        ON fs.course_id = s.course_id AND fs.session_id = s.session_id
       AND fs.version = s.fee_structure_version
    LEFT JOIN public.late_fee_policies lfp
        ON lfp.fee_structure_id = fs.id AND lfp.is_active = true
       AND fc.category = ANY (lfp.applies_to_categories)
    WHERE fl.fee_code_id <> v_late
      AND fl.due_date IS NOT NULL
      AND s.status = 'active'
      AND s.deleted_at IS NULL
      AND (fl.late_fee_config IS NOT NULL OR lfp.id IS NOT NULL)
      AND (_student_id IS NULL OR fl.student_id = _student_id)
  LOOP
    IF rec.balance <= 0 THEN
      v_eff := COALESCE(
        (SELECT MAX(lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date
           FROM public.fee_ledger_payments flp
           JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
          WHERE flp.fee_ledger_id = rec.ledger_id
            AND lp.status = 'confirmed' AND lp.payment_date IS NOT NULL),
        (rec.updated_at AT TIME ZONE 'Asia/Kolkata')::date);
    ELSE
      v_eff := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    END IF;

    v_cfg := rec.cfg;
    IF v_cfg IS NOT NULL THEN
      v_grace := COALESCE((v_cfg->>'grace_days')::int, 0);
      v_cap   := NULLIF(v_cfg->>'max_cap', '')::numeric;
      v_days  := GREATEST(0, (v_eff - rec.due_date) - v_grace);
      IF v_days <= 0 THEN
        v_amt := 0;
      ELSIF (v_cfg->>'penalty_type') = 'daily' THEN
        v_amt := ROUND(COALESCE((v_cfg->>'penalty_amount')::numeric, 0) * v_days, 2);
      ELSIF (v_cfg->>'penalty_type') = 'percentage' THEN
        v_amt := ROUND(GREATEST(rec.balance, 0) * COALESCE((v_cfg->>'penalty_amount')::numeric, 0) / 100, 2);
      ELSE
        v_amt := ROUND(COALESCE((v_cfg->>'penalty_amount')::numeric, 0), 2);
      END IF;
      IF v_cap IS NOT NULL THEN v_amt := LEAST(v_amt, v_cap); END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.fee_ledger b JOIN public.fee_codes bc ON bc.id = b.fee_code_id
         WHERE b.student_id = rec.student_id AND bc.code = ANY (rec.boarding_fee_codes)
      ) THEN
        v_rate := rec.boarding_penalty_amount;
      ELSE
        v_rate := rec.penalty_amount;
      END IF;
      v_days := GREATEST(0, (v_eff - rec.due_date) - rec.grace);
      v_amt  := ROUND(COALESCE(v_rate, 0) * v_days, 2);
      IF rec.max_penalty_cap IS NOT NULL THEN v_amt := LEAST(v_amt, rec.max_penalty_cap); END IF;
    END IF;

    v_late_term := 'late_' || rec.term;
    SELECT id INTO v_existing FROM public.fee_ledger
     WHERE student_id = rec.student_id AND term = v_late_term AND fee_code_id = v_late
     LIMIT 1;

    IF v_amt > 0 THEN
      IF v_existing IS NULL THEN
        INSERT INTO public.fee_ledger
          (student_id, fee_code_id, fee_structure_item_id, term, total_amount, due_date, status)
        VALUES (rec.student_id, v_late, NULL, v_late_term, v_amt, (now() AT TIME ZONE 'Asia/Kolkata')::date, 'due');
      ELSE
        UPDATE public.fee_ledger SET total_amount = GREATEST(v_amt, paid_amount), updated_at = now()
         WHERE id = v_existing;
      END IF;
    ELSE
      DELETE FROM public.fee_ledger WHERE id = v_existing AND paid_amount = 0;
    END IF;
  END LOOP;
END;
$function$;
