-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260728104514 name=provision_retire_advance applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.provision_student_fees(_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE; v_student_id uuid; v_session public.admission_sessions%ROWTYPE;
  v_inserted int := 0; v_applied int := 0; v_total numeric := 0;
  v_lp RECORD; v_target RECORD; v_form_code uuid; v_reg_code uuid;
  v_remaining_amt numeric; v_remaining_conc numeric; v_remaining_total numeric; v_balance numeric;
  v_apply_total numeric; v_apply_amt numeric; v_apply_conc numeric;
  v_year_conc numeric; v_year_key text; v_year_offset int; v_session_start date; v_fs_id uuid;
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

  WITH to_insert AS (
    SELECT fsi.fee_code_id, fsi.term, fsi.amount,
           CASE WHEN fsi.term ~ '^year_[1-9]$'
             THEN (v_session_start + ((substring(fsi.term FROM 'year_(\d+)')::int - 1) || ' years')::interval
                   + ((COALESCE(fsi.due_day,1) - 1) || ' days')::interval)::date
             ELSE v_session_start END AS due_date
      FROM public.fee_structure_items fsi
     WHERE fsi.fee_structure_id = v_fs_id
       AND NOT EXISTS (SELECT 1 FROM public.fee_ledger fl
          WHERE fl.student_id = v_student_id AND fl.fee_code_id = fsi.fee_code_id AND fl.term = fsi.term))
  INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
  SELECT v_student_id, fee_code_id, term, amount, due_date, 'due' FROM to_insert;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT id INTO v_form_code FROM public.fee_codes WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1;
  SELECT id INTO v_reg_code FROM public.fee_codes WHERE code ILIKE '%REG%' AND code NOT ILIKE '%REGION%'
   ORDER BY (CASE WHEN code = 'MR-REG' THEN 0 WHEN code = 'NB-REG' THEN 0 ELSE 1 END) LIMIT 1;

  FOR v_lp IN SELECT * FROM public.lead_payments
     WHERE lead_id = _lead_id AND status = 'confirmed' AND applied_to_ledger = false ORDER BY created_at
  LOOP
    v_remaining_amt := COALESCE(v_lp.amount, 0); v_remaining_conc := COALESCE(v_lp.concession_amount, 0);
    v_remaining_total := v_remaining_amt + v_remaining_conc;

    IF v_lp.type = 'application_fee' AND v_form_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount, concession INTO v_target FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_form_code ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_form_code, 'one_time', GREATEST(v_remaining_total, 1), v_session_start, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target; END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt := CASE WHEN v_remaining_total > 0 THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt, concession = concession + v_apply_conc,
             status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END, updated_at = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
      v_remaining_amt := v_remaining_amt - v_apply_amt; v_remaining_conc := v_remaining_conc - v_apply_conc;
      v_remaining_total := v_remaining_amt + v_remaining_conc;

    ELSIF v_lp.type = 'registration_fee' AND v_reg_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount, concession INTO v_target FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_reg_code ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_reg_code, 'one_time', GREATEST(v_remaining_total, 1), v_session_start, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target; END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt := CASE WHEN v_remaining_total > 0 THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt, concession = concession + v_apply_conc,
             status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END, updated_at = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
      v_remaining_amt := v_remaining_amt - v_apply_amt; v_remaining_conc := v_remaining_conc - v_apply_conc;
      v_remaining_total := v_remaining_amt + v_remaining_conc;

    ELSIF v_lp.type IN ('token_fee', 'other') THEN
      FOR v_year_offset IN 1..8 LOOP
        EXIT WHEN v_remaining_total <= 0;
        v_year_key := 'year_' || v_year_offset::text;
        v_year_conc := COALESCE((v_lp.concession_breakdown ->> v_year_key)::numeric, NULL);
        FOR v_target IN SELECT id, total_amount, paid_amount, concession FROM public.fee_ledger
           WHERE student_id = v_student_id AND term = v_year_key ORDER BY due_date
        LOOP
          EXIT WHEN v_remaining_total <= 0;
          v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
          IF v_balance <= 0 THEN CONTINUE; END IF;
          v_apply_total := LEAST(v_remaining_total, v_balance);
          IF v_lp.concession_breakdown IS NOT NULL AND v_year_conc IS NOT NULL THEN
            v_apply_conc := LEAST(GREATEST(v_year_conc, 0), GREATEST(v_remaining_conc, 0), v_apply_total);
            v_apply_amt := v_apply_total - v_apply_conc;
          ELSE
            v_apply_amt := CASE WHEN v_remaining_total > 0 THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
            v_apply_conc := v_apply_total - v_apply_amt;
          END IF;
          UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt, concession = concession + v_apply_conc,
                 status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END, updated_at = now()
           WHERE id = v_target.id;
          INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
          VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
          v_remaining_amt := v_remaining_amt - v_apply_amt; v_remaining_conc := v_remaining_conc - v_apply_conc;
          v_remaining_total := v_remaining_amt + v_remaining_conc;
          IF v_year_conc IS NOT NULL THEN v_year_conc := v_year_conc - v_apply_conc; END IF;
        END LOOP;
      END LOOP;
    END IF;

    -- advance carry-over REMOVED: leftover stays unapplied = derived credit; apply_student_credit posts it later.

    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    v_applied := v_applied + 1;
    v_total := v_total + COALESCE(v_lp.amount, 0) + COALESCE(v_lp.concession_amount, 0);
  END LOOP;

  RETURN jsonb_build_object('student_id', v_student_id, 'ledger_rows_created', v_inserted,
    'payments_applied', v_applied, 'total_credited', v_total);
END;
$function$;
