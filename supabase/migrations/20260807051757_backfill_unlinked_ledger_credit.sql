-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260807051757 name=backfill_unlinked_ledger_credit applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DO $$
DECLARE
  v_stu  record;
  v_row  record;
  v_pay  record;
  v_gap  numeric;
  v_take numeric;
BEGIN
  FOR v_stu IN
    SELECT s.id AS student_id, s.lead_id
      FROM public.students s
     WHERE s.id IN (SELECT student_id FROM public.v_unaccounted_ledger_credit)
       AND lower(COALESCE(s.name,'')) !~ '(uat|razorpay|icici|demo|dummy)'
  LOOP
    FOR v_row IN
      SELECT fl.id AS ledger_id,
             fl.paid_amount
               - COALESCE((SELECT SUM(p.amount) FROM public.fee_ledger_payments p
                            WHERE p.fee_ledger_id = fl.id), 0) AS gap
        FROM public.fee_ledger fl
       WHERE fl.student_id = v_stu.student_id
         AND fl.paid_amount
               - COALESCE((SELECT SUM(p.amount) FROM public.fee_ledger_payments p
                            WHERE p.fee_ledger_id = fl.id), 0) > 0.009
       ORDER BY fl.due_date NULLS LAST, fl.id
    LOOP
      v_gap := v_row.gap;
      FOR v_pay IN
        SELECT lp.id AS payment_id,
               lp.amount
                 - COALESCE((SELECT SUM(p.amount) FROM public.fee_ledger_payments p
                              WHERE p.lead_payment_id = lp.id), 0) AS cap
          FROM public.lead_payments lp
         WHERE lp.status = 'confirmed'
           AND (lp.lead_id = v_stu.lead_id OR lp.student_id = v_stu.student_id)
           AND lp.amount
                 - COALESCE((SELECT SUM(p.amount) FROM public.fee_ledger_payments p
                              WHERE p.lead_payment_id = lp.id), 0) > 0.009
         ORDER BY lp.created_at
      LOOP
        EXIT WHEN v_gap <= 0.009;
        v_take := LEAST(v_gap, v_pay.cap);
        IF v_take <= 0.009 THEN CONTINUE; END IF;
        INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
        VALUES (v_row.ledger_id, v_pay.payment_id, v_take, 0);
        v_gap := v_gap - v_take;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
