-- Precise per-head due date. fee_structures are per course+session, so an absolute
-- calendar date per item is correct and precise (a new session gets its own structure).
-- fee_structure_items.due_date (date, nullable) is the authoritative due date when set;
-- it takes priority over the relative due_month/due_year_offset config and the year_N
-- stagger. It flows straight into fee_ledger.due_date, which fn_generate_late_fees /
-- fn_mark_overdue_fees already use to compute late fines.

ALTER TABLE public.fee_structure_items
  ADD COLUMN IF NOT EXISTS due_date date;

-- 1. SQL provisioning path: absolute date wins, then relative config, then session start.
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
  v_is_school boolean;
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
             COALESCE(
               fsi.due_date,
               CASE
                 WHEN fsi.due_month IS NOT NULL
                   THEN make_date(extract(year from v_session_start)::int + COALESCE(fsi.due_year_offset,0),
                                  fsi.due_month, LEAST(GREATEST(COALESCE(fsi.due_day,1),1),28))
                 WHEN fsi.term ~ '^year_[1-9]$'
                   THEN (v_session_start + ((substring(fsi.term FROM 'year_(\d+)')::int - 1) || ' years')::interval
                         + ((COALESCE(fsi.due_day,1) - 1) || ' days')::interval)::date
                 ELSE NULL END,
               v_session_start) AS due_date
        FROM public.fee_structure_items fsi
       WHERE fsi.fee_structure_id = v_fs_id
         AND NOT EXISTS (SELECT 1 FROM public.fee_ledger fl
            WHERE fl.student_id = v_student_id AND fl.fee_code_id = fsi.fee_code_id AND fl.term = fsi.term))
    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    SELECT v_student_id, fee_code_id, term, amount, due_date, 'due' FROM to_insert;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;
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
    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    v_applied := v_applied + 1;
    v_total := v_total + COALESCE(v_lp.amount, 0) + COALESCE(v_lp.concession_amount, 0);
  END LOOP;
  RETURN jsonb_build_object('student_id', v_student_id, 'ledger_rows_created', v_inserted,
    'payments_applied', v_applied, 'total_credited', v_total);
END;
$function$;

-- 2. upsert_fee_structure_item: accept the absolute _due_date (wins over month/offset),
--    persist it, and re-sync UNPAID ledgers' due_date accordingly.
DROP FUNCTION IF EXISTS public.upsert_fee_structure_item(uuid,uuid,text,numeric,int,uuid,int,int);
CREATE OR REPLACE FUNCTION public.upsert_fee_structure_item(
  _fee_structure_id uuid, _fee_code_id uuid, _term text, _amount numeric,
  _due_day int DEFAULT 10, _item_id uuid DEFAULT NULL,
  _due_month int DEFAULT NULL, _due_year_offset int DEFAULT 0, _due_date date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_course uuid; v_session uuid; v_base_year int; v_due date;
BEGIN
  IF NOT public.can_manage_fee_structure(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage fee structures'; END IF;
  IF COALESCE(_amount, -1) < 0 THEN RAISE EXCEPTION 'Amount must be >= 0'; END IF;
  IF _due_month IS NOT NULL AND (_due_month < 1 OR _due_month > 12) THEN
    RAISE EXCEPTION 'Due month must be 1-12'; END IF;

  SELECT fs.course_id, fs.session_id, extract(year from a.start_date)::int
    INTO v_course, v_session, v_base_year
    FROM public.fee_structures fs
    LEFT JOIN public.admission_sessions a ON a.id = fs.session_id
   WHERE fs.id = _fee_structure_id;

  IF _item_id IS NOT NULL THEN
    UPDATE public.fee_structure_items
       SET fee_code_id = _fee_code_id, term = _term, amount = _amount,
           due_day = COALESCE(_due_day, due_day),
           due_month = _due_month, due_year_offset = COALESCE(_due_year_offset, 0),
           due_date = _due_date
     WHERE id = _item_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Fee structure item not found'; END IF;
  ELSE
    INSERT INTO public.fee_structure_items
      (fee_structure_id, fee_code_id, term, amount, due_day, due_month, due_year_offset, due_date)
    VALUES (_fee_structure_id, _fee_code_id, _term, _amount, COALESCE(_due_day, 10),
            _due_month, COALESCE(_due_year_offset, 0), _due_date)
    RETURNING id INTO v_id;
  END IF;

  -- resolved due date: absolute wins, else the month/offset config (else leave ledger as-is)
  v_due := _due_date;
  IF v_due IS NULL AND _due_month IS NOT NULL AND v_base_year IS NOT NULL THEN
    v_due := make_date(v_base_year + COALESCE(_due_year_offset,0), _due_month,
                       LEAST(GREATEST(COALESCE(_due_day,1),1),28));
  END IF;

  UPDATE public.fee_ledger fl
     SET total_amount = _amount, due_date = COALESCE(v_due, fl.due_date), updated_at = now()
   WHERE fl.paid_amount = 0
     AND ( fl.fee_structure_item_id = v_id
        OR ( fl.fee_code_id = _fee_code_id AND fl.term = _term
             AND fl.student_id IN (SELECT s.id FROM public.students s
                  WHERE s.course_id = v_course AND s.session_id = v_session) ) );

  RETURN v_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.upsert_fee_structure_item(uuid,uuid,text,numeric,int,uuid,int,int,date) TO authenticated, service_role;
