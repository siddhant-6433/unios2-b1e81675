-- ====================================================================
-- Concession application on the fee_ledger + window-start fix
--   1. fee_ledger_payments tracks the paid + concession split per
--      debit so the ledger zeroes out cleanly when a waiver was used.
--   2. lead_fee_status now anchors token_completed_at to the FIRST
--      confirmed token_fee instalment (not the stage transition that
--      fires only when the 10% threshold is fully met). This keeps
--      the multi-year window honest when the candidate pays token
--      in instalments.
--   3. provision_student_fees rewritten to distribute both amount
--      and concession_amount in proportion across the target ledger
--      rows.
-- ====================================================================

-- 1. Track concession on each ledger debit.
ALTER TABLE public.fee_ledger_payments
  ADD COLUMN IF NOT EXISTS concession_amount numeric(12,2) NOT NULL DEFAULT 0;

-- 2. Window now starts at the first token_fee instalment.
CREATE OR REPLACE FUNCTION public.lead_fee_status(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy          jsonb   := public.lead_fee_policy(_lead_id);
  v_pan_pct         numeric := COALESCE((v_policy->>'pan_threshold_pct')::numeric, 10);
  v_an_pct          numeric := COALESCE((v_policy->>'an_threshold_pct')::numeric, 25);
  v_min_instalment  numeric := COALESCE((v_policy->>'min_token_instalment')::numeric, 5000);
  v_lump_pct        numeric := COALESCE((v_policy->>'lump_sum_first_year_waiver_pct')::numeric, 0);
  v_multi_pct       numeric := COALESCE((v_policy->>'multi_year_waiver_pct')::numeric, 0);
  v_window_days     int     := COALESCE((v_policy->>'multi_year_window_days')::numeric, 0);

  v_first_year      numeric := public.lead_first_year_fee(_lead_id);
  v_total_course    numeric := public.lead_total_course_fee(_lead_id);
  v_additional      numeric := GREATEST(v_total_course - v_first_year, 0);
  v_token_required  numeric := ROUND(v_first_year * v_pan_pct / 100, 2);
  v_an_threshold    numeric := ROUND(v_first_year * v_an_pct / 100, 2);
  v_token_paid      numeric;
  v_app_paid        numeric;
  v_total_paid      numeric;
  v_first_token_at  timestamptz;
  v_window_expires  timestamptz;
  v_days_since      numeric;
  v_in_window       boolean;
  v_lump_disc       numeric;
  v_multi_disc      numeric;
  v_full_year_due   numeric;
  v_full_course_due numeric;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'token_fee'       AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee') AND status = 'confirmed'), 0)
  INTO v_token_paid, v_app_paid, v_total_paid
  FROM public.lead_payments
  WHERE lead_id = _lead_id;

  -- Window anchors on the FIRST confirmed token_fee instalment so a
  -- candidate who pays the token across multiple smaller instalments
  -- doesn't lose the multi-year bonus by virtue of the very last
  -- payment being the one that crossed the threshold.
  SELECT MIN(created_at) INTO v_first_token_at
    FROM public.lead_payments
   WHERE lead_id = _lead_id
     AND type = 'token_fee'
     AND status = 'confirmed';

  IF v_first_token_at IS NOT NULL THEN
    v_window_expires := v_first_token_at + (v_window_days || ' days')::interval;
    v_days_since     := EXTRACT(EPOCH FROM (now() - v_first_token_at)) / 86400.0;
    v_in_window      := now() <= v_window_expires;
  ELSE
    v_window_expires := NULL;
    v_days_since     := NULL;
    v_in_window      := true;
  END IF;

  v_lump_disc      := ROUND(v_first_year * v_lump_pct / 100, 2);
  v_full_year_due  := GREATEST(v_first_year - v_total_paid - v_lump_disc, 0);

  v_multi_disc     := ROUND(v_additional * v_lump_pct / 100, 2)
                    + (CASE WHEN v_in_window THEN ROUND(v_additional * v_multi_pct / 100, 2) ELSE 0 END);
  v_full_course_due := GREATEST(v_total_course - v_total_paid - v_lump_disc - v_multi_disc, 0);

  RETURN jsonb_build_object(
    'first_year_fee',       v_first_year,
    'total_course_fee',     v_total_course,
    'additional_years_fee', v_additional,
    'token_required',       v_token_required,
    'token_paid',           v_token_paid,
    'application_paid',     v_app_paid,
    'total_paid',           v_total_paid,
    'twenty_five_pct',      v_an_threshold,
    'an_threshold',         v_an_threshold,
    'pan_threshold_pct',    v_pan_pct,
    'an_threshold_pct',     v_an_pct,
    'min_token_instalment', v_min_instalment,
    'token_complete',       (v_first_year > 0 AND v_token_paid >= v_token_required),
    'twenty_five_complete', (v_first_year > 0 AND v_total_paid >= v_an_threshold),
    'token_completed_at',   v_first_token_at,         -- anchor: first instalment
    'multi_year_window_expires_at', v_window_expires, -- new: hard deadline
    'days_since_token',     v_days_since,
    'within_multi_year_window', v_in_window,
    'lump_sum_pct',         v_lump_pct,
    'multi_year_pct',       v_multi_pct,
    'multi_year_window_days', v_window_days,
    'full_first_year_discount', v_lump_disc,
    'full_first_year_amount_due', v_full_year_due,
    'full_course_discount',  (v_lump_disc + v_multi_disc),
    'full_course_amount_due', v_full_course_due,
    'policy',               v_policy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_status TO authenticated, service_role;

-- 3. provision_student_fees: distribute amount + concession together.
CREATE OR REPLACE FUNCTION public.provision_student_fees(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead       public.leads%ROWTYPE;
  v_student_id uuid;
  v_inserted   int := 0;
  v_applied    int := 0;
  v_total      numeric := 0;
  v_lp         RECORD;
  v_target     RECORD;
  v_form_code  uuid;
  v_reg_code   uuid;
  v_remaining_amt   numeric;
  v_remaining_conc  numeric;
  v_remaining_total numeric;
  v_balance         numeric;
  v_apply_total     numeric;
  v_apply_amt       numeric;
  v_apply_conc      numeric;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND OR v_lead.session_id IS NULL OR v_lead.course_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing lead/session/course');
  END IF;

  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row yet');
  END IF;

  -- (a) Provision ledger from fee_structure_items (idempotent).
  WITH fs AS (
    SELECT id FROM public.fee_structures
     WHERE course_id = v_lead.course_id
       AND session_id = v_lead.session_id
       AND is_active = true
     LIMIT 1
  ),
  to_insert AS (
    SELECT fsi.fee_code_id, fsi.term, fsi.amount,
           COALESCE((current_date + (COALESCE(fsi.due_day,1)-1)::int)::date, current_date) AS due_date
      FROM public.fee_structure_items fsi
      JOIN fs ON fs.id = fsi.fee_structure_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.fee_ledger fl
        WHERE fl.student_id = v_student_id
          AND fl.fee_code_id = fsi.fee_code_id
          AND fl.term        = fsi.term
     )
  )
  INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
  SELECT v_student_id, fee_code_id, term, amount, due_date, 'due'
    FROM to_insert;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT id INTO v_form_code FROM public.fee_codes
   WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1;
  SELECT id INTO v_reg_code FROM public.fee_codes
   WHERE code ILIKE '%REG%' AND code NOT ILIKE '%REGION%'
   ORDER BY (CASE WHEN code = 'MR-REG' THEN 0 WHEN code = 'NB-REG' THEN 0 ELSE 1 END) LIMIT 1;

  -- (b) Apply each unapplied confirmed lead_payment.
  FOR v_lp IN
    SELECT * FROM public.lead_payments
     WHERE lead_id = _lead_id
       AND status = 'confirmed'
       AND applied_to_ledger = false
     ORDER BY created_at
  LOOP
    v_remaining_amt   := COALESCE(v_lp.amount, 0);
    v_remaining_conc  := COALESCE(v_lp.concession_amount, 0);
    v_remaining_total := v_remaining_amt + v_remaining_conc;

    IF v_lp.type = 'application_fee' AND v_form_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount, concession INTO v_target
        FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_form_code
       ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_form_code, 'one_time', GREATEST(v_remaining_total, 1), current_date, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target;
      END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt  := CASE WHEN v_remaining_total > 0
                           THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2)
                           ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply_amt,
             concession  = concession  + v_apply_conc,
             status      = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at  = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
      v_remaining_amt   := v_remaining_amt   - v_apply_amt;
      v_remaining_conc  := v_remaining_conc  - v_apply_conc;
      v_remaining_total := v_remaining_amt + v_remaining_conc;

    ELSIF v_lp.type = 'registration_fee' AND v_reg_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount, concession INTO v_target
        FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_reg_code
       ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_reg_code, 'one_time', GREATEST(v_remaining_total, 1), current_date, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target;
      END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt  := CASE WHEN v_remaining_total > 0
                           THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2)
                           ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply_amt,
             concession  = concession  + v_apply_conc,
             status      = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at  = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
      v_remaining_amt   := v_remaining_amt   - v_apply_amt;
      v_remaining_conc  := v_remaining_conc  - v_apply_conc;
      v_remaining_total := v_remaining_amt + v_remaining_conc;

    ELSIF v_lp.type IN ('token_fee', 'other') THEN
      -- Spread across year_N items by oldest due date. token_fee fills
      -- year_1 first; "other" (the lump-sum / full-course CTAs) keeps
      -- going into year_2/3/4 once year_1 is full.
      FOR v_target IN
        SELECT id, total_amount, paid_amount, concession FROM public.fee_ledger
         WHERE student_id = v_student_id
           AND term LIKE 'year\_%' ESCAPE '\'
         ORDER BY term, due_date
      LOOP
        EXIT WHEN v_remaining_total <= 0;
        v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
        IF v_balance <= 0 THEN CONTINUE; END IF;
        v_apply_total := LEAST(v_remaining_total, v_balance);
        v_apply_amt  := CASE WHEN v_remaining_total > 0
                             THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2)
                             ELSE 0 END;
        v_apply_conc := v_apply_total - v_apply_amt;
        UPDATE public.fee_ledger
           SET paid_amount = paid_amount + v_apply_amt,
               concession  = concession  + v_apply_conc,
               status      = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
               updated_at  = now()
         WHERE id = v_target.id;
        INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
        VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
        v_remaining_amt   := v_remaining_amt   - v_apply_amt;
        v_remaining_conc  := v_remaining_conc  - v_apply_conc;
        v_remaining_total := v_remaining_amt + v_remaining_conc;
      END LOOP;
    END IF;

    -- Anything that didn't fit anywhere becomes an advance carry-over.
    IF v_remaining_total > 0 THEN
      INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, paid_amount, concession, due_date, status)
      VALUES (
        v_student_id,
        COALESCE(v_form_code, (SELECT id FROM public.fee_codes ORDER BY code LIMIT 1)),
        'advance', GREATEST(v_remaining_total, 1), v_remaining_amt, v_remaining_conc, current_date, 'paid'
      ) RETURNING id INTO v_target;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount, notes)
      VALUES (v_target.id, v_lp.id, v_remaining_amt, v_remaining_conc, 'Carry-over advance from ' || v_lp.type);
    END IF;

    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    v_applied := v_applied + 1;
    v_total   := v_total + COALESCE(v_lp.amount, 0) + COALESCE(v_lp.concession_amount, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'student_id',          v_student_id,
    'ledger_rows_created', v_inserted,
    'payments_applied',    v_applied,
    'total_credited',      v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_student_fees TO authenticated, service_role;
