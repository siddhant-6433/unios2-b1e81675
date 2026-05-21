-- ====================================================================
-- Backfill: re-run provision_student_fees for any lead whose confirmed
-- lead_payments still have applied_to_ledger=false despite the lead
-- having a PAN/AN.
--
-- Root cause: a window of pg_net body-type failures (fixed in #41 /
-- 20260613130000_fix_pgnet_body_jsonb.sql) caused the lead_payments
-- AFTER trigger to roll back its provision_student_fees call,
-- leaving fee_ledger.paid_amount partially updated but fee_ledger_payments
-- empty and applied_to_ledger=false. Symptom: candidate has a paid
-- Application Fee receipt but the Application/Form Fee ledger row
-- still shows ₹X due.
--
-- The provision_student_fees function itself is correct; verified by
-- calling it directly for lead 716ae82d (Bhavna) — all three of her
-- payments reconciled cleanly. This migration just sweeps the rest.
-- ====================================================================

DO $$
DECLARE
  v_lead_id uuid;
  v_count   int := 0;
BEGIN
  FOR v_lead_id IN
    SELECT DISTINCT lp.lead_id
      FROM public.lead_payments lp
      JOIN public.leads l ON l.id = lp.lead_id
     WHERE lp.status = 'confirmed'
       AND lp.applied_to_ledger = false
       AND l.pre_admission_no IS NOT NULL
  LOOP
    PERFORM public.provision_student_fees(v_lead_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[backfill-unapplied-payments] reconciled % leads', v_count;
END $$;
