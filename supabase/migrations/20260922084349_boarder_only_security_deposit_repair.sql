-- Boarder-only security deposits must not be billed to day scholars.
--
-- NB-SEC (Beacon) and MR-SEC (Mirai) are named "…Security Deposit (Boarders
-- Only)" but are tagged category 'enrollment'. The edge provisioner only
-- enforces the boarder/day-scholar split inside its category='hostel' branch,
-- so the enrollment branch billed every new-admission student the deposit.
--
-- The provisioner filter is fixed in supabase/functions/provision-student-fees
-- (security deposits are now matched by code and gated to boarders, and the
-- student_type vocabulary is normalised: day_scholar = "Day Scholar";
-- hostel / boarder / HOSTELER = boarder; "Day Boarder" stays separate).
--
-- This migration removes the rows already created, only where nothing has been
-- paid against them (mirrors remove_fee_charge's guardrail).

DO $repair$
DECLARE
  r RECORD;
  v_removed int := 0;
BEGIN
  FOR r IN
    SELECT fl.id, fl.student_id, fc.code AS fee_code, fl.total_amount, s.student_type
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
      JOIN public.students s ON s.id = fl.student_id
     WHERE fc.code IN ('NB-SEC','MR-SEC')
       AND COALESCE(fl.paid_amount, 0) = 0
       AND NOT EXISTS (
         SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.fee_ledger_id = fl.id
       )
       AND lower(btrim(regexp_replace(coalesce(s.student_type, 'day_scholar'), '[_\s]+', ' ', 'g')))
           NOT IN ('boarder', 'hostel', 'hosteler')
  LOOP
    DELETE FROM public.fee_ledger WHERE id = r.id;
    v_removed := v_removed + 1;
    RAISE NOTICE '[repair] removed % (₹%) from student % (student_type=%) — boarder-only head on a non-boarder',
      r.fee_code, r.total_amount, r.student_id, r.student_type;
  END LOOP;
  RAISE NOTICE '[repair] boarder-only security deposits removed: %', v_removed;
END $repair$;

NOTIFY pgrst, 'reload schema';
