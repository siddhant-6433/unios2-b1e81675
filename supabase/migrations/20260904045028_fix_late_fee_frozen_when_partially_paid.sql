-- Late fine stuck too high once a partial payment lands on the LATE-FEE row.
--
-- fn_recompute_late_fees raises/corrects a `late_<term>` fee_ledger row from the
-- parent fee's config. When the parent fee is paid, the accrual window freezes to
-- the (possibly back-dated) payment_date, so the owed fine drops to what was due
-- as of that date. But the corrective UPDATE was guarded with `paid_amount = 0`:
--
--     UPDATE fee_ledger SET total_amount = v_amt WHERE id = v_existing AND paid_amount = 0;
--
-- The daily generate-late-fees cron runs before the payment settles, so it can
-- over-accrue the fine (counting to "today") and create the LATE-FEE row at the
-- higher amount. When the receipt then settles -- back-dated to the real pay date
-- -- the recompute correctly computes the lower frozen amount, but if any part of
-- the fine was collected in that same receipt, `paid_amount` is no longer 0 and
-- the UPDATE is silently skipped. The row is stranded at the over-accrued total,
-- leaving a phantom balance that reads "Overdue" forever.
--
-- Example: tuition due 31 Aug, Rs 100/day. Cron on 2 Sep (tuition still unpaid)
-- raises the fine to Rs 200 (2 days). Receipt back-dated to 1 Sep then pays the
-- tuition + Rs 100 fine. Freeze date = 1 Sep => 1 day => Rs 100 owed, but the
-- Rs 100 already booked against the fine blocks the 200 -> 100 correction. Row
-- sticks at Rs 200 total / Rs 100 balance.
--
-- Fix: drop the paid_amount guard and clamp to paid_amount, so the total is
-- always corrected to the computed amount but never below money already
-- collected (which would create a negative balance). This also fixes the mirror
-- case of an *outstanding* fee whose fine used to stop growing after the first
-- partial payment. balance/status are recomputed by trg_fee_ledger_settle_status.

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
        -- Correct the total even after a partial payment has been booked against
        -- the fine. Clamp to paid_amount so we never drop the total below money
        -- already collected (which would leave a negative balance). The old
        -- `paid_amount = 0` guard stranded an over-accrued fine at its high value.
        UPDATE public.fee_ledger SET total_amount = GREATEST(v_amt, paid_amount), updated_at = now()
         WHERE id = v_existing;
      END IF;
    ELSE
      -- No fine owed. Only remove the row if nothing was ever collected against
      -- it; a fine with booked money is settled, not deleted.
      DELETE FROM public.fee_ledger WHERE id = v_existing AND paid_amount = 0;
    END IF;
  END LOOP;
END;
$function$;
