
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

