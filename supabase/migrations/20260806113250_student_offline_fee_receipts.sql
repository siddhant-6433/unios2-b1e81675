-- ====================================================================
-- Offline fee receipts for post-admission students who have NO admission
-- lead (school pupils: Nursery..Grade XII are provisioned straight into
-- students+fee_ledger, students.lead_id IS NULL). The whole offline
-- collect/receipt pipeline runs through lead_payments; the only thing
-- stopping a lead-less student from using it is that lead_payments.lead_id
-- is NOT NULL. fee_ledger, receipt numbering and the row-targeted
-- settlement are already student-keyed.
--
-- Approach: let a lead_payments row belong to a student directly (nullable
-- student_id, nullable lead_id, exactly-one CHECK). The confirm trigger
-- settles via a student-entry sibling of provision_student_fees. The
-- lead-only side triggers (stage advance, consultant payout, staff
-- incentives) simply no-op on a lead-less row; the app-fee / token /
-- marketing / incentive / notify triggers already early-return because a
-- school receipt is neither application_fee nor token_fee and rides
-- gateway='offline'. The cash-window guard resolves the campus from the
-- student instead of the lead.
-- ====================================================================

-- 1. lead_payments can belong to a student instead of a lead ------------
ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.lead_payments ALTER COLUMN lead_id DROP NOT NULL;

ALTER TABLE public.lead_payments DROP CONSTRAINT IF EXISTS lead_payments_lead_or_student_ck;
ALTER TABLE public.lead_payments
  ADD CONSTRAINT lead_payments_lead_or_student_ck
  CHECK (lead_id IS NOT NULL OR student_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_lead_payments_student
  ON public.lead_payments (student_id) WHERE student_id IS NOT NULL;

-- 2. Null-lead guards on the three lead-only side triggers --------------
--    (each currently PERFORMs a lead-keyed function unconditionally).
CREATE OR REPLACE FUNCTION public.handle_lead_payment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'INSERT') AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;  -- student receipt: no lead stage

  PERFORM public.recompute_lead_fee_stage(NEW.lead_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recompute_consultant_payout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.lead_id IS NOT NULL THEN PERFORM public.recompute_consultant_payout(OLD.lead_id); END IF;
    RETURN OLD;
  END IF;
  IF NEW.lead_id IS NOT NULL THEN PERFORM public.recompute_consultant_payout(NEW.lead_id); END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_refresh_staff_incentives_from_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lead_id IS NOT NULL THEN PERFORM public.refresh_staff_incentives_for_lead(NEW.lead_id); END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.amount IS DISTINCT FROM NEW.amount OR OLD.lead_id IS DISTINCT FROM NEW.lead_id THEN
      IF NEW.lead_id IS NOT NULL THEN PERFORM public.refresh_staff_incentives_for_lead(NEW.lead_id); END IF;
      IF OLD.lead_id IS DISTINCT FROM NEW.lead_id AND OLD.lead_id IS NOT NULL THEN
        PERFORM public.refresh_staff_incentives_for_lead(OLD.lead_id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Cash-window guard: resolve campus from the student on a lead-less row
CREATE OR REPLACE FUNCTION public.enforce_cash_receipt_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_campus uuid;
  v_check  jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.payment_mode <> 'cash' THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'lead_payments' THEN
    IF NEW.status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;
    IF NEW.lead_id IS NOT NULL THEN
      SELECT l.campus_id INTO v_campus FROM public.leads l WHERE l.id = NEW.lead_id;
    ELSE
      SELECT s.campus_id INTO v_campus FROM public.students s WHERE s.id = NEW.student_id;
    END IF;
  ELSE  -- public.payments (post-admission student cash)
    SELECT s.campus_id INTO v_campus FROM public.students s WHERE s.id = NEW.student_id;
  END IF;

  v_check := public.can_create_cash_receipt(v_campus);
  IF NOT (v_check->>'allowed')::boolean THEN
    RAISE EXCEPTION '%', v_check->>'reason' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Confirm trigger settles by lead OR by student ---------------------
CREATE OR REPLACE FUNCTION public.tg_credit_payments_on_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NOT NULL THEN
    PERFORM public.provision_student_fees(NEW.lead_id);
  ELSIF NEW.student_id IS NOT NULL THEN
    PERFORM public.provision_student_fees_for_student(NEW.student_id);
  END IF;
  RETURN NEW;
END $function$;

-- 5. Student-entry settlement -----------------------------------------
--    A focused sibling of provision_student_fees for lead-less students.
--    School fee_ledger rows are already provisioned, so there is no
--    structure/row creation and no application-fee logic — only the
--    row-targeted allocations branch (what the counter always sends) and
--    an earliest-due fallback. Budget & every read are student-keyed.
--    Idempotent: re-runs recompute budget from confirmed - already-paid
--    and per-(payment,row) amounts already booked in fee_ledger_payments.
CREATE OR REPLACE FUNCTION public.provision_student_fees_for_student(_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_applied int := 0;
  v_lp RECORD; v_target RECORD; v_row public.fee_ledger%ROWTYPE;
  v_budget numeric; v_already_paid numeric; v_confirmed numeric;
  v_balance numeric; v_apply_amt numeric;
  v_alloc jsonb; v_fc uuid; v_fl uuid; v_alloc_amt numeric;
  v_already_fc numeric; v_remaining_alloc numeric; v_alloc_fully boolean; v_mark_applied boolean;
BEGIN
  IF _student_id IS NULL THEN RETURN jsonb_build_object('skipped', true, 'reason', 'no student'); END IF;

  SELECT COALESCE(SUM(paid_amount),0) INTO v_already_paid FROM public.fee_ledger WHERE student_id = _student_id;
  SELECT COALESCE(SUM(amount),0) INTO v_confirmed FROM public.lead_payments
    WHERE student_id = _student_id AND status = 'confirmed';
  v_budget := GREATEST(v_confirmed - v_already_paid, 0);

  FOR v_lp IN
    SELECT * FROM public.lead_payments
     WHERE student_id = _student_id AND status = 'confirmed' AND applied_to_ledger = false
       AND ( allocations IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lead_payments.id) )
     ORDER BY created_at
  LOOP
    v_mark_applied := true;

    IF v_lp.allocations IS NOT NULL AND jsonb_array_length(v_lp.allocations) > 0 THEN
      v_alloc_fully := true;
      FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_lp.allocations) LOOP
        v_fc := NULLIF(v_alloc->>'fee_code_id','')::uuid;
        v_fl := NULLIF(v_alloc->>'fee_ledger_id','')::uuid;
        v_alloc_amt := COALESCE((v_alloc->>'amount')::numeric, 0);
        IF v_alloc_amt <= 0 THEN CONTINUE; END IF;

        -- Row-targeted: the cashier ticked this exact ledger row.
        IF v_fl IS NOT NULL THEN
          SELECT * INTO v_row FROM public.fee_ledger WHERE id = v_fl AND student_id = _student_id;
          IF NOT FOUND THEN v_alloc_fully := false; CONTINUE; END IF;

          SELECT COALESCE(SUM(flp.amount),0) INTO v_already_fc
            FROM public.fee_ledger_payments flp
           WHERE flp.lead_payment_id = v_lp.id AND flp.fee_ledger_id = v_fl;
          v_remaining_alloc := v_alloc_amt - v_already_fc;
          IF v_remaining_alloc <= 0 THEN CONTINUE; END IF;

          v_balance := v_row.total_amount - v_row.concession - v_row.paid_amount;
          v_apply_amt := LEAST(v_balance, v_remaining_alloc, v_budget);
          IF v_apply_amt > 0 THEN
            UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
                   status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
                   updated_at = now()
             WHERE id = v_fl;
            INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
            VALUES (v_fl, v_lp.id, v_apply_amt, 0);
            v_budget := v_budget - v_apply_amt;
            v_remaining_alloc := v_remaining_alloc - v_apply_amt;
          END IF;
          IF v_remaining_alloc > 0.009 THEN v_alloc_fully := false; END IF;
          CONTINUE;
        END IF;

        -- Code-targeted spillover (no exact row): earliest-due first.
        IF v_fc IS NULL THEN CONTINUE; END IF;
        SELECT COALESCE(SUM(flp.amount),0) INTO v_already_fc
          FROM public.fee_ledger_payments flp JOIN public.fee_ledger fl2 ON fl2.id = flp.fee_ledger_id
         WHERE flp.lead_payment_id = v_lp.id AND fl2.fee_code_id = v_fc;
        v_remaining_alloc := v_alloc_amt - v_already_fc;
        IF v_remaining_alloc <= 0 THEN CONTINUE; END IF;

        FOR v_target IN
          SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
            FROM public.fee_ledger fl
           WHERE fl.student_id = _student_id AND fl.fee_code_id = v_fc
             AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
           ORDER BY fl.due_date NULLS LAST, fl.term, fl.id
        LOOP
          EXIT WHEN v_remaining_alloc <= 0 OR v_budget <= 0;
          v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
          v_apply_amt := LEAST(v_balance, v_remaining_alloc, v_budget);
          IF v_apply_amt <= 0 THEN CONTINUE; END IF;
          UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
                 status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
                 updated_at = now()
           WHERE id = v_target.id;
          INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
          VALUES (v_target.id, v_lp.id, v_apply_amt, 0);
          v_budget := v_budget - v_apply_amt;
          v_remaining_alloc := v_remaining_alloc - v_apply_amt;
        END LOOP;
        IF v_remaining_alloc > 0.009 THEN v_alloc_fully := false; END IF;
      END LOOP;
      v_mark_applied := v_alloc_fully;

    ELSE
      -- No per-head breakup: apply to this student's unpaid rows, earliest-due.
      FOR v_target IN
        SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
          FROM public.fee_ledger fl
         WHERE fl.student_id = _student_id
           AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
         ORDER BY fl.due_date NULLS LAST, fl.total_amount DESC
      LOOP
        EXIT WHEN v_budget <= 0;
        v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
        v_apply_amt := LEAST(v_balance, v_budget);
        IF v_apply_amt <= 0 THEN CONTINUE; END IF;
        UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
               status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
               updated_at = now()
         WHERE id = v_target.id;
        INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
        VALUES (v_target.id, v_lp.id, v_apply_amt, 0);
        v_budget := v_budget - v_apply_amt;
      END LOOP;
    END IF;

    IF v_mark_applied THEN
      UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    END IF;
    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('student_id', _student_id, 'payments_applied', v_applied);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.provision_student_fees_for_student(uuid) TO authenticated, service_role;

-- 6. student_letterhead: institution name + campus address for a student
--    (course → department → institution → campus), mirroring lead_letterhead.
CREATE OR REPLACE FUNCTION public.student_letterhead(_student_id uuid)
RETURNS TABLE(institution_name text, address text, campus_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT i.name                                AS institution_name,
         COALESCE(icam.address, scam.address)  AS address,
         scam.name                             AS campus_name
    FROM public.students s
    LEFT JOIN public.campuses    scam ON scam.id = s.campus_id
    LEFT JOIN public.courses     co   ON co.id   = s.course_id
    LEFT JOIN public.departments d    ON d.id    = co.department_id
    LEFT JOIN public.institutions i   ON i.id    = d.institution_id
    LEFT JOIN public.campuses    icam ON icam.id = i.campus_id
   WHERE s.id = _student_id;
$$;

GRANT EXECUTE ON FUNCTION public.student_letterhead(uuid) TO authenticated, service_role;

-- 7. v_all_payments: a lead-less lead_payments row still resolves its
--    student (person name / admission no / campus) for reports.
CREATE OR REPLACE VIEW public.v_all_payments WITH (security_invoker=true) AS
  SELECT
    'student'::text AS source, p.id, p.amount, p.payment_mode, p.transaction_ref, p.receipt_no,
    p.paid_at, p.recorded_by, p.notes, p.student_id, s.lead_id,
    NULL::text AS fee_type, p.fee_ledger_id,
    COALESCE(s.name, '') AS person_name, s.admission_no, s.pre_admission_no, s.campus_id,
    p.created_at, NULL::text AS gateway, lfc.name AS fee_head
    FROM public.payments p
    LEFT JOIN public.students s   ON s.id = p.student_id
    LEFT JOIN public.fee_ledger fl ON fl.id = p.fee_ledger_id
    LEFT JOIN public.fee_codes lfc ON lfc.id = fl.fee_code_id
  UNION ALL
  SELECT
    'lead'::text AS source, lp.id, lp.amount, lp.payment_mode, lp.transaction_ref, lp.receipt_no,
    lp.payment_date AS paid_at, lp.recorded_by, lp.notes, s.id AS student_id, lp.lead_id,
    lp.type AS fee_type, NULL::uuid AS fee_ledger_id,
    COALESCE(s.name, l.name, '') AS person_name, s.admission_no, s.pre_admission_no,
    COALESCE(s.campus_id, l.campus_id) AS campus_id,
    lp.created_at, lp.gateway,
    COALESCE(fc.name, CASE lp.type
        WHEN 'application_fee'     THEN 'Application Fee'
        WHEN 'token_fee'           THEN 'Token Fee'
        WHEN 'pre_admission_token' THEN 'Token Fee (prior to admission)'
        WHEN 'registration_fee'    THEN 'Registration Fee'
        WHEN 'other'               THEN 'Other Charges'
        ELSE initcap(replace(lp.type, '_', ' ')) END) AS fee_head
    FROM public.lead_payments lp
    LEFT JOIN public.leads l    ON l.id = lp.lead_id
    LEFT JOIN public.students s ON (s.id = lp.student_id)
                                OR (lp.student_id IS NULL AND s.lead_id = lp.lead_id)
    LEFT JOIN public.fee_codes fc ON fc.id = lp.fee_code_id
  WHERE lp.status = 'confirmed';
