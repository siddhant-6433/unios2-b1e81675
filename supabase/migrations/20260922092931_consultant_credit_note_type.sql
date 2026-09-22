-- Consultant credit notes are non-cash settlements of a student's fee. One was
-- filed with type='application_fee' (Pranjal Singh, receipt N382, ₹7,000). B.Ed
-- has no portal application fee, so this made student_fee_credit_balance report
-- a bogus "Application fee paid ₹7,000" on the student's Finance panel, and
-- moved that ₹7,000 out of other_paid.
--
-- Reclassify consultant-credit-note receipts that are typed application_fee to
-- 'other'. The ledger allocation (fee_ledger_payments) is untouched, so paid
-- amounts, balances and unallocated credit do not change; only the receipt's
-- type label is corrected.
--
-- Only 2 consultant-credit-note receipts exist: Kumari Meera's ₹10,000 is
-- correctly typed pre_admission_token; only Pranjal's is affected.

DO $repair$
DECLARE
  r RECORD;
  v_fixed int := 0;
BEGIN
  FOR r IN
    SELECT lp.id, lp.receipt_no, lp.amount,
           (SELECT s.name FROM public.students s WHERE s.lead_id = lp.lead_id LIMIT 1) AS student
      FROM public.lead_payments lp
     WHERE lp.type = 'application_fee'
       AND lp.status = 'confirmed'
       AND lp.notes ILIKE '%Consultant credit note%'
  LOOP
    UPDATE public.lead_payments SET type = 'other' WHERE id = r.id;
    v_fixed := v_fixed + 1;
    RAISE NOTICE '[repair] reclassified consultant credit note % (₹%) for % from application_fee to other',
      r.receipt_no, r.amount, r.student;
  END LOOP;
  RAISE NOTICE '[repair] consultant credit notes reclassified: %', v_fixed;
END $repair$;

NOTIFY pgrst, 'reload schema';
