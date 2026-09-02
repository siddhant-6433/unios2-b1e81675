-- Late fine must be recomputed the moment a fee is settled, not the next night.
--
-- fn_recompute_late_fees() already implements the correct rule: once the base
-- row's balance is clear it freezes the accrual at
--   v_eff := MAX(payment_date of confirmed payments booked against that row)
-- (falling back to fee_ledger.updated_at), and only uses CURRENT_DATE while the
-- row is still outstanding. Days are GREATEST(0, v_eff - due_date - grace), so
-- paying ON the due date yields 0 days and the LATE-FEE row is deleted.
--
-- The gap was purely when it runs. Its only callers were the nightly cron
-- generate-late-fees-daily (00:35 UTC) and apply_student_credit(). Settling a
-- payment did not call it, so a fee paid on its due date still carried the
-- fine that had been raised earlier -- for up to a day, and a cashier
-- collecting "total due" that day would have charged it.
--
-- Wire it into the same trigger that settles the payment. Recursion is already
-- bounded: this body only runs at pg_trigger_depth() = 1, and the fee_ledger
-- insert fn_recompute_late_fees may make is absorbed by the depth guard in
-- tg_credit_payments_after_ledger_insert.

CREATE OR REPLACE FUNCTION public.tg_credit_payments_on_confirm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_student uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NOT NULL THEN
    PERFORM public.provision_student_fees(NEW.lead_id);
    SELECT id INTO v_student FROM public.students WHERE lead_id = NEW.lead_id;
  ELSIF NEW.student_id IS NOT NULL THEN
    PERFORM public.provision_student_fees_for_student(NEW.student_id);
    v_student := NEW.student_id;
  END IF;

  -- Re-freeze / clear this student's late fines against the payment date now
  -- that the ledger has moved.
  IF v_student IS NOT NULL THEN
    PERFORM public.fn_recompute_late_fees(v_student);
  END IF;

  RETURN NEW;
END $function$;
