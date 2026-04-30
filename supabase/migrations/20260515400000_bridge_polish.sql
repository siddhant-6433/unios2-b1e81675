-- ====================================================================
-- Post-AN bridge polish — B1 / B2 / B3 / B4
--
-- B1  Provision ledger at PAN, not just AN
--     handle_lead_payment_change now calls provision_student_fees
--     whenever the lead has a pre_admission_no — pre-AN students see
--     their full ledger as soon as they're pre-admitted.
--
-- B2  Real due dates
--     provision_student_fees computes due_date as
--       session.start_date + year_offset + (due_day − 1 days)
--     instead of "today + due_day". Honours each year's actual schedule.
--
-- B3  Precise concession distribution
--     New lead_payments.concession_breakdown JSONB (e.g.
--     {"year_1": 5000, "year_2": 7500}). When set, provision_student_fees
--     applies each year's concession only to that year's ledger items.
--     When unset, falls back to proportional spread across year_N rows.
--
-- B4  Per-campus fee_structures
--     Added nullable fee_structures.campus_id. Resolution functions
--     prefer a campus-specific structure when one exists, else fall
--     back to a course-level row (campus_id IS NULL).
-- ====================================================================

-- B3: per-year concession map.
ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS concession_breakdown jsonb;

COMMENT ON COLUMN public.lead_payments.concession_breakdown IS
  'Optional per-year concession map, e.g. {"year_1": 5000, "year_2": 7500}. When set, sums to concession_amount and is applied to the matching year_N ledger items. When NULL, the bridge spreads concession_amount proportionally.';

-- B4: optional campus pin on fee_structures.
ALTER TABLE public.fee_structures
  ADD COLUMN IF NOT EXISTS campus_id uuid REFERENCES public.campuses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fee_structures_campus ON public.fee_structures(campus_id);

-- B4: lookup that prefers (course, session, campus) match, falls back
-- to (course, session, campus_id IS NULL).
CREATE OR REPLACE FUNCTION public.lead_fee_structure_id(_lead_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fs.id
    FROM public.leads l
    JOIN public.fee_structures fs
      ON fs.course_id  = l.course_id
     AND fs.session_id = l.session_id
     AND fs.is_active  = true
   WHERE l.id = _lead_id
   ORDER BY (CASE WHEN fs.campus_id = l.campus_id THEN 0
                  WHEN fs.campus_id IS NULL THEN 1
                  ELSE 2 END)
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_structure_id TO authenticated, service_role;

-- B4: rebuild lead_first_year_fee and lead_total_course_fee on top
-- of the campus-aware lookup.
CREATE OR REPLACE FUNCTION public.lead_first_year_fee(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(fsi.amount), 0)::numeric
  FROM public.fee_structure_items fsi
  WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
    AND fsi.term = 'year_1';
$$;

GRANT EXECUTE ON FUNCTION public.lead_first_year_fee TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lead_total_course_fee(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(fsi.amount), 0)::numeric
  FROM public.fee_structure_items fsi
  WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
    AND fsi.term LIKE 'year\_%' ESCAPE '\';
$$;

GRANT EXECUTE ON FUNCTION public.lead_total_course_fee TO authenticated, service_role;

-- B2 + B3: rewrite provision_student_fees with proper due-dates and
-- per-year concession application.
CREATE OR REPLACE FUNCTION public.provision_student_fees(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead         public.leads%ROWTYPE;
  v_student_id   uuid;
  v_session      public.admission_sessions%ROWTYPE;
  v_inserted     int := 0;
  v_applied      int := 0;
  v_total        numeric := 0;
  v_lp           RECORD;
  v_target       RECORD;
  v_form_code    uuid;
  v_reg_code     uuid;
  v_remaining_amt   numeric;
  v_remaining_conc  numeric;
  v_remaining_total numeric;
  v_balance         numeric;
  v_apply_total     numeric;
  v_apply_amt       numeric;
  v_apply_conc      numeric;
  v_year_conc       numeric;
  v_year_key        text;
  v_year_offset     int;
  v_session_start   date;
  v_fs_id           uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND OR v_lead.session_id IS NULL OR v_lead.course_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing lead/session/course');
  END IF;

  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row yet');
  END IF;

  SELECT * INTO v_session FROM public.admission_sessions WHERE id = v_lead.session_id;
  v_session_start := COALESCE(v_session.start_date, current_date);

  v_fs_id := public.lead_fee_structure_id(_lead_id);
  IF v_fs_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no matching fee_structure');
  END IF;

  -- (a) Provision ledger from fee_structure_items, one row per item still missing.
  --     due_date = session.start_date + (year_offset × 1 year) + (due_day - 1 days)
  WITH to_insert AS (
    SELECT fsi.fee_code_id,
           fsi.term,
           fsi.amount,
           CASE
             WHEN fsi.term ~ '^year_[1-9]$'
               THEN (v_session_start
                     + ((substring(fsi.term FROM 'year_(\d+)')::int - 1) || ' years')::interval
                     + ((COALESCE(fsi.due_day,1) - 1) || ' days')::interval)::date
             ELSE v_session_start
           END AS due_date
      FROM public.fee_structure_items fsi
     WHERE fsi.fee_structure_id = v_fs_id
       AND NOT EXISTS (
         SELECT 1 FROM public.fee_ledger fl
          WHERE fl.student_id = v_student_id
            AND fl.fee_code_id = fsi.fee_code_id
            AND fl.term        = fsi.term
       )
  )
  INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
  SELECT v_student_id, fee_code_id, term, amount, due_date, 'due' FROM to_insert;
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
     WHERE lead_id = _lead_id AND status = 'confirmed' AND applied_to_ledger = false
     ORDER BY created_at
  LOOP
    v_remaining_amt   := COALESCE(v_lp.amount, 0);
    v_remaining_conc  := COALESCE(v_lp.concession_amount, 0);
    v_remaining_total := v_remaining_amt + v_remaining_conc;

    -- application_fee → form-fee row.
    IF v_lp.type = 'application_fee' AND v_form_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount, concession INTO v_target
        FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_form_code
       ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_form_code, 'one_time', GREATEST(v_remaining_total, 1), v_session_start, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target;
      END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt  := CASE WHEN v_remaining_total > 0
                           THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply_amt,
             concession  = concession  + v_apply_conc,
             status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at = now()
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
        VALUES (v_student_id, v_reg_code, 'one_time', GREATEST(v_remaining_total, 1), v_session_start, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target;
      END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt  := CASE WHEN v_remaining_total > 0
                           THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply_amt,
             concession  = concession  + v_apply_conc,
             status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
      v_remaining_amt   := v_remaining_amt   - v_apply_amt;
      v_remaining_conc  := v_remaining_conc  - v_apply_conc;
      v_remaining_total := v_remaining_amt + v_remaining_conc;

    ELSIF v_lp.type IN ('token_fee', 'other') THEN
      -- B3: when concession_breakdown is set, walk year-by-year and use the
      -- per-year concession from the breakdown instead of a proportional
      -- spread. Cash (amount) still flows oldest-first.
      FOR v_year_offset IN 1..8 LOOP
        EXIT WHEN v_remaining_total <= 0;
        v_year_key := 'year_' || v_year_offset::text;
        v_year_conc := COALESCE((v_lp.concession_breakdown ->> v_year_key)::numeric, NULL);
        FOR v_target IN
          SELECT id, total_amount, paid_amount, concession FROM public.fee_ledger
           WHERE student_id = v_student_id AND term = v_year_key
           ORDER BY due_date
        LOOP
          EXIT WHEN v_remaining_total <= 0;
          v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
          IF v_balance <= 0 THEN CONTINUE; END IF;

          v_apply_total := LEAST(v_remaining_total, v_balance);
          IF v_lp.concession_breakdown IS NOT NULL AND v_year_conc IS NOT NULL THEN
            -- Bound concession in this year by what the breakdown earmarked.
            v_apply_conc := LEAST(GREATEST(v_year_conc, 0), GREATEST(v_remaining_conc, 0), v_apply_total);
            v_apply_amt  := v_apply_total - v_apply_conc;
          ELSE
            v_apply_amt  := CASE WHEN v_remaining_total > 0
                                 THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
            v_apply_conc := v_apply_total - v_apply_amt;
          END IF;

          UPDATE public.fee_ledger
             SET paid_amount = paid_amount + v_apply_amt,
                 concession  = concession  + v_apply_conc,
                 status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
                 updated_at = now()
           WHERE id = v_target.id;
          INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
          VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);

          v_remaining_amt   := v_remaining_amt   - v_apply_amt;
          v_remaining_conc  := v_remaining_conc  - v_apply_conc;
          v_remaining_total := v_remaining_amt + v_remaining_conc;
          IF v_year_conc IS NOT NULL THEN v_year_conc := v_year_conc - v_apply_conc; END IF;
        END LOOP;
      END LOOP;
    END IF;

    -- Carry-over advance for anything that didn't fit any bucket.
    IF v_remaining_total > 0 THEN
      INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, paid_amount, concession, due_date, status)
      VALUES (
        v_student_id,
        COALESCE(v_form_code, (SELECT id FROM public.fee_codes ORDER BY code LIMIT 1)),
        'advance', GREATEST(v_remaining_total, 1), v_remaining_amt, v_remaining_conc, v_session_start, 'paid'
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

-- B1: re-create handle_lead_payment_change to also provision when
-- pre_admission_no is set (i.e. PAN-only candidates).
CREATE OR REPLACE FUNCTION public.handle_lead_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status          jsonb;
  v_lead            public.leads%ROWTYPE;
  v_pan             text;
  v_an              text;
  v_student_id      uuid;
  v_pan_just_issued boolean := false;
  v_an_just_issued  boolean := false;
BEGIN
  IF (TG_OP = 'INSERT') AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_status := public.lead_fee_status(NEW.lead_id);

  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_lead.id;
    IF v_student_id IS NULL THEN
      INSERT INTO public.students (
        name, phone, email, guardian_name, guardian_phone,
        course_id, campus_id, lead_id, session_id,
        pre_admission_no, status
      ) VALUES (
        v_lead.name, v_lead.phone, v_lead.email,
        v_lead.guardian_name, v_lead.guardian_phone,
        v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
        v_pan, 'pre_admitted'
      ) RETURNING id INTO v_student_id;
    ELSE
      UPDATE public.students
         SET pre_admission_no = COALESCE(pre_admission_no, v_pan),
             status = COALESCE(status, 'pre_admitted')
       WHERE id = v_student_id;
      SELECT pre_admission_no INTO v_pan FROM public.students WHERE id = v_student_id;
    END IF;

    UPDATE public.leads SET pre_admission_no = v_pan, stage = 'token_paid' WHERE id = v_lead.id;
    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion', 'Token fee complete — Pre-admitted with PAN: ' || v_pan, 'token_paid');

    SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
    v_pan_just_issued := true;
  END IF;

  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students
       SET admission_no = COALESCE(admission_no, v_an), status = 'active'
     WHERE lead_id = v_lead.id RETURNING admission_no INTO v_an;

    UPDATE public.leads SET admission_no = v_an, stage = 'admitted' WHERE id = v_lead.id;
    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion', '25% fee paid — Admitted with AN: ' || v_an, 'admitted');
    v_an_just_issued := true;
  END IF;

  -- B1: provision/sync the ledger any time the candidate is at PAN or AN.
  IF v_lead.pre_admission_no IS NOT NULL OR v_pan_just_issued OR v_an_just_issued THEN
    PERFORM public.provision_student_fees(NEW.lead_id);
  END IF;

  RETURN NEW;
END;
$$;
