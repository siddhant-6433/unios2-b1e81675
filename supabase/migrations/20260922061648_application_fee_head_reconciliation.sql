-- ====================================================================
-- Application Fee must be its own ledger head, never a course head.
--
-- Bug: two provisioners credited application-fee receipts to course heads.
--   1. Edge fn provision-student-fees credited confirmed 'application_fee'
--      payments onto the year-1 SEAT/BLOCK row (DAOTT).
--   2. SQL provision_student_fees resolved the application-fee code with
--      `fc.code ILIKE '%FORM%'`, which also matches the UNIFORM fee code
--      (category 'other'), so app fees landed on the Uniform head.
--
-- Result: the receipt that backs the seat-block "paid" is an application-fee
-- receipt, the course balance reads ₹1,000 low, and the unallocated credit
-- reads ₹1,000 low (DAOTT 2026-28, receipt N652; 13 students).
--
-- Fix:
--   * resolve the application-fee code by category='enrollment' AND a
--     FORM/REG code (never the bare %FORM% match);
--   * provision_student_fees keeps applying receipts, but to the right head;
--   * new reconcile_application_fee() moves any existing app-fee link onto
--     the student's Application Fee head and applies unlinked app-fee
--     receipts there. Idempotent. Excludes receipts whose portal application
--     fee is 0 (B.Ed / D.El.Ed), which are a separate mis-typing.
--
-- The PAN/AN unlock is unaffected: lead_fee_status computes v_app_paid from
-- lead_payments and adds LEAST(v_app_paid, seat_block) to paid_toward_course,
-- independently of which ledger head holds the money.
-- ====================================================================

-- 1. Widen the reallocation audit so the repair has an honest action label.
ALTER TABLE public.fee_ledger_reallocation_audit
  DROP CONSTRAINT IF EXISTS fee_ledger_reallocation_audit_action_check;
ALTER TABLE public.fee_ledger_reallocation_audit
  ADD CONSTRAINT fee_ledger_reallocation_audit_action_check
  CHECK (action IN ('apply_credit','transfer','unapply_to_credit','app_fee_head_repair'));

-- 2. Fix the application-fee code resolver in the SQL provisioner.
--    Only the two resolver predicates changed from the live definition in
--    20260901083504_fix_fee_budget_ignores_unbacked_ledger_paid.sql.
CREATE OR REPLACE FUNCTION public.provision_student_fees(_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE; v_student_id uuid; v_session public.admission_sessions%ROWTYPE;
  v_inserted int := 0; v_applied int := 0; v_total numeric := 0;
  v_lp RECORD; v_target RECORD;
  v_balance numeric; v_apply_total numeric; v_apply_amt numeric; v_apply_conc numeric;
  v_year_offset int; v_year_key text; v_session_start date; v_fs_id uuid;
  v_is_school boolean;
  v_budget numeric; v_already_paid numeric; v_confirmed numeric;
  v_app_fee numeric; v_app_code uuid;
  v_alloc jsonb; v_fc uuid; v_alloc_amt numeric; v_already_fc numeric;
  v_remaining_alloc numeric; v_alloc_fully boolean; v_mark_applied boolean;
  v_fl uuid; v_row public.fee_ledger%ROWTYPE;
  v_placed numeric;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND OR v_lead.session_id IS NULL OR v_lead.course_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing lead/session/course'); END IF;
  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id;
  IF v_student_id IS NULL THEN RETURN jsonb_build_object('skipped', true, 'reason', 'no student row yet'); END IF;
  SELECT * INTO v_session FROM public.admission_sessions WHERE id = v_lead.session_id;
  v_session_start := COALESCE(v_session.start_date, current_date);
  v_fs_id := public.lead_fee_structure_id(_lead_id);
  IF v_fs_id IS NULL THEN RETURN jsonb_build_object('skipped', true, 'reason', 'no matching fee_structure'); END IF;
  v_is_school := public.student_course_is_school(v_lead.course_id);

  IF NOT v_is_school THEN
    WITH to_insert AS (
      SELECT fsi.fee_code_id, fsi.term, fsi.amount,
             COALESCE(fsi.due_date,
               CASE
                 WHEN fsi.due_month IS NOT NULL
                   THEN make_date(extract(year from v_session_start)::int + COALESCE(fsi.due_year_offset,0),
                                  fsi.due_month, LEAST(GREATEST(COALESCE(fsi.due_day,1),1),28))
                 WHEN fsi.term ~ '^year_[1-9]$'
                   THEN (v_session_start + ((substring(fsi.term FROM 'year_(\d+)')::int - 1) || ' years')::interval
                         + ((COALESCE(fsi.due_day,1) - 1) || ' days')::interval)::date
                 ELSE NULL END, v_session_start) AS due_date
        FROM public.fee_structure_items fsi
       WHERE fsi.fee_structure_id = v_fs_id
         AND NOT EXISTS (SELECT 1 FROM public.fee_ledger fl
            WHERE fl.student_id = v_student_id AND fl.fee_code_id = fsi.fee_code_id AND fl.term = fsi.term))
    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    SELECT v_student_id, fee_code_id, term, amount, due_date, 'due' FROM to_insert;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  SELECT a.fee_amount INTO v_app_fee
    FROM public.applications a WHERE a.lead_id = _lead_id
    ORDER BY a.created_at DESC NULLS LAST LIMIT 1;
  v_app_fee := COALESCE(v_app_fee, 0);

  -- Application-fee code: category='enrollment' AND a FORM/REG code. The
  -- category guard is what stops UNIFORM (category 'other', code contains
  -- "FORM") from being mistaken for the application fee.
  SELECT fl.fee_code_id INTO v_app_code
    FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.student_id = v_student_id
     AND fc.category = 'enrollment'
     AND (fc.code ILIKE '%FORM%' OR (fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
   ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END), fl.due_date LIMIT 1;
  IF v_app_code IS NULL THEN
    SELECT fsi.fee_code_id INTO v_app_code
      FROM public.fee_structure_items fsi JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
     WHERE fsi.fee_structure_id = v_fs_id
       AND fc.category = 'enrollment'
       AND (fc.code ILIKE '%FORM%' OR (fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
     ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END) LIMIT 1;
  END IF;
  IF v_app_code IS NULL THEN
    SELECT id INTO v_app_code FROM public.fee_codes WHERE code = 'FORM-FEE' LIMIT 1;
  END IF;

  -- Money from THIS scope's confirmed payments that is already booked into
  -- the ledger. Deliberately not SUM(fee_ledger.paid_amount): imported and
  -- opening paid balances carry no lead_payments row, so they would consume
  -- the whole budget and a genuine new receipt would apply zero rupees
  -- while still minting a receipt (Kotputli Y2 cohort, 2026-09-01).
  SELECT COALESCE(SUM(flp.amount),0) INTO v_already_paid
    FROM public.fee_ledger_payments flp
    JOIN public.lead_payments lp2 ON lp2.id = flp.lead_payment_id
   WHERE lp2.status = 'confirmed' AND lp2.lead_id = _lead_id;
  SELECT COALESCE(SUM(amount),0) INTO v_confirmed FROM public.lead_payments
    WHERE lead_id = _lead_id AND status = 'confirmed';
  v_budget := GREATEST(v_confirmed - v_already_paid, 0);

  FOR v_lp IN
    SELECT * FROM public.lead_payments
     WHERE lead_id = _lead_id AND status = 'confirmed' AND applied_to_ledger = false
       AND ( allocations IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lead_payments.id) )
     ORDER BY (type = 'application_fee') DESC, created_at
  LOOP
    v_mark_applied := true;
    v_placed := 0;

    IF v_lp.allocations IS NOT NULL AND jsonb_array_length(v_lp.allocations) > 0 THEN
      v_alloc_fully := true;
      FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_lp.allocations) LOOP
        v_fc := (v_alloc->>'fee_code_id')::uuid;
        v_fl := NULLIF(v_alloc->>'fee_ledger_id','')::uuid;
        v_alloc_amt := COALESCE((v_alloc->>'amount')::numeric, 0);
        IF v_alloc_amt <= 0 THEN CONTINUE; END IF;

        IF v_fl IS NOT NULL THEN
          SELECT * INTO v_row FROM public.fee_ledger
           WHERE id = v_fl AND student_id = v_student_id;
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

        IF v_fc IS NULL THEN CONTINUE; END IF;

        SELECT COALESCE(SUM(flp.amount),0) INTO v_already_fc
          FROM public.fee_ledger_payments flp JOIN public.fee_ledger fl2 ON fl2.id = flp.fee_ledger_id
         WHERE flp.lead_payment_id = v_lp.id AND fl2.fee_code_id = v_fc;
        v_remaining_alloc := v_alloc_amt - v_already_fc;
        IF v_remaining_alloc <= 0 THEN CONTINUE; END IF;

        FOR v_target IN
          SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
            FROM public.fee_ledger fl
           WHERE fl.student_id = v_student_id AND fl.fee_code_id = v_fc
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

    ELSIF v_lp.type = 'application_fee' THEN
      IF v_budget > 0 AND v_app_fee > 0 AND v_app_code IS NOT NULL THEN
        SELECT id, total_amount, paid_amount, concession INTO v_target FROM public.fee_ledger
         WHERE student_id = v_student_id AND fee_code_id = v_app_code ORDER BY due_date LIMIT 1;
        IF v_target.id IS NULL THEN
          INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
          VALUES (v_student_id, v_app_code, 'registration', v_app_fee, v_session_start, 'due')
          RETURNING id, total_amount, paid_amount, concession INTO v_target;
        END IF;
        v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
        v_apply_amt := LEAST(v_lp.amount, GREATEST(v_balance,0), v_budget);
        IF v_apply_amt > 0 THEN
          UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
                 status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
                 updated_at = now()
           WHERE id = v_target.id;
          INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
          VALUES (v_target.id, v_lp.id, v_apply_amt, 0);
          v_budget := v_budget - v_apply_amt;
          v_placed := v_placed + v_apply_amt;
        END IF;
      END IF;
      v_mark_applied := v_placed >= v_lp.amount - 0.009;
    ELSE
      FOR v_target IN
        SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
          FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
         WHERE fl.student_id = v_student_id
           AND ( (NOT v_is_school AND fl.term ~ '^year_[1-9]$')
                 OR (v_is_school AND fl.term ~ '^q[1-4]$' AND fc.category IN ('tuition','hostel')) )
           AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
         ORDER BY fl.due_date, fl.total_amount DESC
      LOOP
        EXIT WHEN v_budget <= 0 OR (v_lp.amount - v_placed) <= 0.009;
        v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
        v_apply_amt := LEAST(v_balance, v_budget, v_lp.amount - v_placed);
        IF v_apply_amt <= 0 THEN CONTINUE; END IF;
        UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
               status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
               updated_at = now()
         WHERE id = v_target.id;
        INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
        VALUES (v_target.id, v_lp.id, v_apply_amt, 0);
        v_budget := v_budget - v_apply_amt;
        v_placed := v_placed + v_apply_amt;
      END LOOP;
      v_mark_applied := v_placed >= v_lp.amount - 0.009;
    END IF;

    IF v_mark_applied THEN
      UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    END IF;
    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('student_id', v_student_id, 'ledger_rows_created', v_inserted,
    'payments_applied', v_applied, 'app_fee', v_app_fee);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.provision_student_fees(uuid) TO authenticated, service_role;

-- 3. Canonical application-fee reconciler. Moves app-fee links off any
--    non-application head onto the student's Application Fee head, and applies
--    unlinked confirmed app-fee receipts there. Idempotent; safe to re-run.
CREATE OR REPLACE FUNCTION public.reconcile_application_fee(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id     uuid;
  v_session_start  date;
  v_portal         numeric;
  v_app_code       uuid;
  v_app_row        public.fee_ledger%ROWTYPE;
  v_link           RECORD;
  v_pay            RECORD;
  v_move           numeric;
  v_moved          numeric := 0;
  v_applied        numeric := 0;
BEGIN
  SELECT s.id INTO v_student_id FROM public.students s WHERE s.lead_id = _lead_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row');
  END IF;

  SELECT COALESCE(a.fee_amount, 0) INTO v_portal
    FROM public.applications a WHERE a.lead_id = _lead_id
    ORDER BY a.created_at DESC NULLS LAST LIMIT 1;
  v_portal := COALESCE(v_portal, 0);
  IF v_portal <= 0 THEN
    -- No portal application fee (B.Ed / D.El.Ed). Nothing legitimate to book.
    RETURN jsonb_build_object('skipped', true, 'reason', 'no portal application fee');
  END IF;

  SELECT COALESCE(sess.start_date, current_date) INTO v_session_start
    FROM public.students s
    LEFT JOIN public.admission_sessions sess ON sess.id = s.session_id
   WHERE s.id = v_student_id;

  SELECT fl.fee_code_id INTO v_app_code
    FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.student_id = v_student_id
     AND fc.category = 'enrollment'
     AND (fc.code ILIKE '%FORM%' OR (fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
   ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END), fl.due_date NULLS LAST, fl.id
   LIMIT 1;
  IF v_app_code IS NULL THEN
    SELECT fsi.fee_code_id INTO v_app_code
      FROM public.fee_structure_items fsi
      JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
      JOIN public.fee_structures fs ON fs.id = fsi.fee_structure_id
      JOIN public.students s ON s.course_id = fs.course_id
     WHERE s.id = v_student_id
       AND fc.category = 'enrollment'
       AND (fc.code ILIKE '%FORM%' OR (fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
     ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END) LIMIT 1;
  END IF;
  IF v_app_code IS NULL THEN
    SELECT id INTO v_app_code FROM public.fee_codes WHERE code = 'FORM-FEE' LIMIT 1;
  END IF;
  IF v_app_code IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no application-fee code');
  END IF;

  SELECT * INTO v_app_row FROM public.fee_ledger
   WHERE student_id = v_student_id AND fee_code_id = v_app_code
   ORDER BY due_date NULLS LAST, id LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    VALUES (v_student_id, v_app_code, 'registration', v_portal, v_session_start, 'due')
    RETURNING * INTO v_app_row;
  END IF;

  -- (a) Move application-fee links that sit on a non-application head.
  FOR v_link IN
    SELECT flp.id AS link_id, flp.fee_ledger_id AS src_id, flp.amount AS link_amount,
           flp.lead_payment_id AS payment_id
      FROM public.fee_ledger_payments flp
      JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.student_id = v_student_id
       AND lp.status = 'confirmed'
       AND lp.type = 'application_fee'
       AND fl.id <> v_app_row.id
       AND NOT (fc.code IN ('FORM-FEE','MR-REG','NB-REG') OR fc.name ILIKE '%application fee%')
  LOOP
    v_move := LEAST(
      v_link.link_amount,
      GREATEST(v_app_row.total_amount - v_app_row.concession - v_app_row.paid_amount, 0)
    );
    IF v_move <= 0 THEN CONTINUE; END IF;

    UPDATE public.fee_ledger
       SET paid_amount = GREATEST(paid_amount - v_move, 0),
           status = CASE
             WHEN GREATEST(paid_amount - v_move, 0) + COALESCE(concession, 0) >= total_amount THEN 'paid'
             WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE THEN 'overdue'
             ELSE 'due' END,
           updated_at = now()
     WHERE id = v_link.src_id;

    UPDATE public.fee_ledger_payments SET fee_ledger_id = v_app_row.id WHERE id = v_link.link_id;

    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_move,
           status = CASE WHEN paid_amount + v_move + COALESCE(concession, 0) >= total_amount THEN 'paid' ELSE status END,
           updated_at = now()
     WHERE id = v_app_row.id;

    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, from_fee_ledger_id, to_fee_ledger_id, from_fee_code, to_fee_code,
       from_term, to_term, amount, reason, actor_role, before_json, after_json)
    SELECT v_student_id, 'app_fee_head_repair', v_link.src_id, v_app_row.id,
           src_fc.code, dst_fc.code, src_fl.term, v_app_row.term, v_move,
           format('Application fee receipt moved off %s onto the Application Fee head', src_fc.code),
           'migration',
           jsonb_build_object('payment_id', v_link.payment_id, 'from_ledger_id', v_link.src_id),
           jsonb_build_object('to_ledger_id', v_app_row.id)
      FROM public.fee_ledger src_fl
      JOIN public.fee_codes src_fc ON src_fc.id = src_fl.fee_code_id
      LEFT JOIN public.fee_codes dst_fc ON dst_fc.id = v_app_row.fee_code_id
     WHERE src_fl.id = v_link.src_id;

    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_link.payment_id;

    v_app_row.paid_amount := v_app_row.paid_amount + v_move;
    v_moved := v_moved + v_move;
  END LOOP;

  -- (b) Apply confirmed but unlinked application-fee receipts to the head.
  FOR v_pay IN
    SELECT lp.id, lp.amount
      FROM public.lead_payments lp
     WHERE lp.lead_id = _lead_id AND lp.status = 'confirmed' AND lp.type = 'application_fee'
       AND NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lp.id)
     ORDER BY lp.created_at
  LOOP
    v_move := LEAST(
      v_pay.amount,
      GREATEST(v_app_row.total_amount - v_app_row.concession - v_app_row.paid_amount, 0)
    );
    IF v_move <= 0 THEN CONTINUE; END IF;

    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_move,
           status = CASE WHEN paid_amount + v_move + COALESCE(concession, 0) >= total_amount THEN 'paid' ELSE status END,
           updated_at = now()
     WHERE id = v_app_row.id;
    INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
    VALUES (v_app_row.id, v_pay.id, v_move, 0);

    v_app_row.paid_amount := v_app_row.paid_amount + v_move;
    v_applied := v_applied + v_move;
  END LOOP;

  IF v_moved > 0 OR v_applied > 0 THEN
    PERFORM public.sync_fee_ledger_concessions(v_student_id);
  END IF;

  RETURN jsonb_build_object(
    'student_id', v_student_id,
    'moved_from_wrong_heads', v_moved,
    'applied_unlinked', v_applied
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reconcile_application_fee(uuid) TO authenticated, service_role;

-- 4. Repair every student whose confirmed application-fee receipt is linked to
--    a non-application head. Students with a portal application fee of 0 are
--    skipped by reconcile_application_fee (separate mis-typing, not this bug).
DO $repair$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT s.lead_id
      FROM public.fee_ledger_payments flp
      JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
      JOIN public.students s ON s.id = fl.student_id
     WHERE lp.status = 'confirmed'
       AND lp.type = 'application_fee'
       AND NOT (fc.code IN ('FORM-FEE','MR-REG','NB-REG') OR fc.name ILIKE '%application fee%')
       AND s.lead_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_application_fee(r.lead_id);
  END LOOP;
END $repair$;

NOTIFY pgrst, 'reload schema';
