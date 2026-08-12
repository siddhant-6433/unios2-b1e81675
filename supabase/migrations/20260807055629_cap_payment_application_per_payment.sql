-- Cap each payment's ledger application at the payment's own value.
--
-- Root cause: provision_student_fees() / provision_student_fees_for_student()
-- credit the tuition/token ("ELSE") ledger rows with v_apply_amt =
-- LEAST(balance, v_budget). v_budget is the SHARED budget across ALL of a lead's
-- confirmed payments (sum of confirmed − already paid), NOT the amount of the
-- single payment currently being placed. So the FIRST payment in the loop can
-- absorb the whole budget and get a fee_ledger_payments link larger than itself.
--
-- Before 2026-08-06 this only mis-attributed money (a link amount > the payment)
-- but still "worked". The duplicate-payment guard added that day
-- (20260806050610) now raises 'This transaction cannot be spent twice' on that
-- oversized link, which aborts the fee_ledger insert entirely — so any student
-- with two+ token payments (e.g. a ₹3,850 + ₹2,000 pre_admission_token split)
-- can no longer be provisioned at all, leaving them paid-but-unprovisioned with
-- no admission number. The application_fee branch already caps by v_lp.amount;
-- this brings the ELSE branch in line by also bounding it to the payment's own
-- remaining value (v_lp.amount − v_placed), so a two-payment split books as two
-- correctly-sized links instead of one oversized one.

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

  SELECT fl.fee_code_id INTO v_app_code
    FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.student_id = v_student_id
     AND (fc.code ILIKE '%FORM%' OR (fc.category='enrollment' AND fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
   ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END), fl.due_date LIMIT 1;
  IF v_app_code IS NULL THEN
    SELECT fsi.fee_code_id INTO v_app_code
      FROM public.fee_structure_items fsi JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
     WHERE fsi.fee_structure_id = v_fs_id
       AND (fc.code ILIKE '%FORM%' OR (fc.category='enrollment' AND fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
     ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END) LIMIT 1;
  END IF;
  IF v_app_code IS NULL THEN
    SELECT id INTO v_app_code FROM public.fee_codes WHERE code = 'FORM-FEE' LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(paid_amount),0) INTO v_already_paid FROM public.fee_ledger WHERE student_id = v_student_id;
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
        -- Bound by the shared budget AND this payment's own remaining value so a
        -- single payment never links to more than it is worth (the guard trips
        -- otherwise). v_placed is the running total already booked for v_lp.
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

-- Lead-less (school) sibling — same ELSE-branch fix, plus a v_placed tracker it
-- previously lacked.
CREATE OR REPLACE FUNCTION public.provision_student_fees_for_student(_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_applied int := 0;
  v_lp RECORD; v_target RECORD; v_row public.fee_ledger%ROWTYPE;
  v_budget numeric; v_already_paid numeric; v_confirmed numeric;
  v_balance numeric; v_apply_amt numeric; v_placed numeric;
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
    v_placed := 0;
    IF v_lp.allocations IS NOT NULL AND jsonb_array_length(v_lp.allocations) > 0 THEN
      v_alloc_fully := true;
      FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_lp.allocations) LOOP
        v_fc := NULLIF(v_alloc->>'fee_code_id','')::uuid;
        v_fl := NULLIF(v_alloc->>'fee_ledger_id','')::uuid;
        v_alloc_amt := COALESCE((v_alloc->>'amount')::numeric, 0);
        IF v_alloc_amt <= 0 THEN CONTINUE; END IF;
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
      FOR v_target IN
        SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
          FROM public.fee_ledger fl
         WHERE fl.student_id = _student_id
           AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
         ORDER BY fl.due_date NULLS LAST, fl.total_amount DESC
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
    END IF;
    IF v_mark_applied THEN
      UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    END IF;
    v_applied := v_applied + 1;
  END LOOP;
  RETURN jsonb_build_object('student_id', _student_id, 'payments_applied', v_applied);
END;
$function$;
