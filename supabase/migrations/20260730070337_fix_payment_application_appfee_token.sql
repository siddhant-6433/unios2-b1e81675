-- ====================================================================
-- Correct payment→ledger application so it works for school AND college,
-- credits the Application Fee (portal amount) to the right row, handles
-- pre_admission_token, and — crucially — is SAFE to run on students the
-- edge provisioner already credited (no double-credit, no disturbing
-- existing receipts / paid rows).
--
-- KEY: budget guard. Each run only creates NEW credit up to
--   (sum of confirmed payments) - (current sum of paid_amount).
-- So if the edge fn already reflected a payment in paid_amount, the guard
-- excludes it; only genuinely-uncredited money (e.g. an uncredited
-- application fee, or a school token) gets applied. Purely additive.
--
-- Application fee target: the student's own registration/form row
-- (FORM-FEE / NB-REG / MR-REG). If the structure has such a code but the
-- ledger row is missing (enrollment-row version filtering), create it with
-- the PORTAL amount (applications.fee_amount). B.Ed / D.El.Ed portal fee is
-- 0 -> nothing created. Seat-block (DAOTT-SEAT) is intentionally NOT treated
-- as the application fee.
-- ====================================================================

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

  -- College: ensure the structure's rows exist (idempotent).
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

  -- Portal-defined application fee for this student's application.
  SELECT a.fee_amount INTO v_app_fee
    FROM public.applications a WHERE a.lead_id = _lead_id
    ORDER BY a.created_at DESC NULLS LAST LIMIT 1;
  v_app_fee := COALESCE(v_app_fee, 0);

  -- Resolve the application-fee fee_code for this student:
  --  1) a registration/form code already on the student's ledger,
  --  2) else a registration/form code in the student's fee_structure,
  --  3) else the global FORM-FEE code.
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

  -- Budget: only create NEW credit up to (confirmed payments - already paid).
  SELECT COALESCE(SUM(paid_amount),0) INTO v_already_paid FROM public.fee_ledger WHERE student_id = v_student_id;
  SELECT COALESCE(SUM(amount),0) INTO v_confirmed FROM public.lead_payments
    WHERE lead_id = _lead_id AND status = 'confirmed';
  v_budget := GREATEST(v_confirmed - v_already_paid, 0);

  -- Apply confirmed, not-yet-linked payments. Application fee first so it lands
  -- on the Application Fee row before token consumes the budget.
  FOR v_lp IN
    SELECT * FROM public.lead_payments
     WHERE lead_id = _lead_id AND status = 'confirmed' AND applied_to_ledger = false
       AND NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lead_payments.id)
     ORDER BY (type = 'application_fee') DESC, created_at
  LOOP
    IF v_lp.type = 'application_fee' THEN
      IF v_budget > 0 AND v_app_fee > 0 AND v_app_code IS NOT NULL THEN
        -- Ensure the Application Fee row exists (portal amount as total).
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
        END IF;
      END IF;
    ELSE
      -- token_fee / pre_admission_token / registration_fee / other -> tuition+boarding,
      -- earliest-due first. College uses year_N; school uses q1..q4.
      FOR v_target IN
        SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
          FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
         WHERE fl.student_id = v_student_id
           AND ( (NOT v_is_school AND fl.term ~ '^year_[1-9]$')
                 OR (v_is_school AND fl.term ~ '^q[1-4]$' AND fc.category IN ('tuition','hostel')) )
           AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
         ORDER BY fl.due_date, fl.total_amount DESC
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

    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('student_id', v_student_id, 'ledger_rows_created', v_inserted,
    'payments_applied', v_applied, 'app_fee', v_app_fee);
END;
$function$;

-- ====================================================================
-- Going-forward: apply confirmed payments to the ledger automatically.
-- Both call the idempotent, budget-guarded provision_student_fees so they
-- can coexist with the edge provisioner without ever double-crediting.
-- ====================================================================

-- After fee_ledger rows are created (e.g. at admission by the edge provisioner).
CREATE OR REPLACE FUNCTION public.tg_credit_payments_after_ledger_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;   -- avoid recursion via provision's own inserts
  FOR r IN SELECT DISTINCT s.lead_id FROM new_rows nr JOIN students s ON s.id = nr.student_id LOOP
    PERFORM public.provision_student_fees(r.lead_id);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_ledger_credit_after_insert ON public.fee_ledger;
CREATE TRIGGER fee_ledger_credit_after_insert
AFTER INSERT ON public.fee_ledger
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tg_credit_payments_after_ledger_insert();

-- When a payment is confirmed (incl. post-admission).
CREATE OR REPLACE FUNCTION public.tg_credit_payments_on_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  PERFORM public.provision_student_fees(NEW.lead_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lead_payments_credit_ledger ON public.lead_payments;
CREATE TRIGGER lead_payments_credit_ledger
AFTER INSERT OR UPDATE OF status ON public.lead_payments
FOR EACH ROW WHEN (NEW.status = 'confirmed')
EXECUTE FUNCTION public.tg_credit_payments_on_confirm();
