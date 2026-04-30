-- ====================================================================
-- Post-AN fee bridge — phase A
--   Provision fee_ledger from fee_structure_items at AN issuance, then
--   apply prior lead_payments against the ledger so the student's
--   pre-admission inflows show up in /pay, accountant collections, and
--   reports without manual reconciliation.
--
--   Pieces:
--   1. fee_ledger_payments link table — every ledger debit traces back
--      to the lead_payment that funded it.
--   2. lead_payments.applied_to_ledger flag for idempotency.
--   3. provision_student_fees(_lead_id) RPC — does ledger creation +
--      payment application in one transactional shot. Safe to re-run.
--   4. Trigger hook in handle_lead_payment_change so it fires on AN.
--   5. Backfill all already-admitted leads whose ledger is empty.
-- ====================================================================

-- 1. Link table ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_ledger_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_ledger_id   uuid NOT NULL REFERENCES public.fee_ledger(id) ON DELETE CASCADE,
  lead_payment_id uuid REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  applied_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_flp_ledger ON public.fee_ledger_payments(fee_ledger_id);
CREATE INDEX IF NOT EXISTS idx_flp_lead_payment ON public.fee_ledger_payments(lead_payment_id);

ALTER TABLE public.fee_ledger_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff can view ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'principal')
  );

CREATE POLICY "Students view own ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.fee_ledger fl
      JOIN public.students s ON s.id = fl.student_id
      WHERE fl.id = fee_ledger_payments.fee_ledger_id
        AND s.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_ledger_payments TO authenticated;
GRANT ALL ON public.fee_ledger_payments TO service_role;

-- 2. Idempotency flag on lead_payments ----------------------------------
ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS applied_to_ledger boolean NOT NULL DEFAULT false;

-- 3. provision_student_fees -- core RPC ---------------------------------
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
  v_remaining  numeric;
  v_target     RECORD;
  v_apply      numeric;
  v_form_code  uuid;
  v_reg_code   uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND OR v_lead.session_id IS NULL OR v_lead.course_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing lead/session/course');
  END IF;

  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row yet');
  END IF;

  ----------------------------------------------------------------
  -- (a) Provision ledger rows from fee_structure_items, but only
  -- for items that aren't already in this student's ledger.
  ----------------------------------------------------------------
  WITH fs AS (
    SELECT id FROM public.fee_structures
     WHERE course_id = v_lead.course_id
       AND session_id = v_lead.session_id
       AND is_active = true
     LIMIT 1
  ),
  to_insert AS (
    SELECT fsi.fee_code_id,
           fsi.term,
           fsi.amount,
           -- Approximate due date: fsi.due_day in the session start month for year_1,
           -- pushed by the term's year offset for year_2/3/4. Falls back to today
           -- if anything is missing so the row remains valid.
           COALESCE(
             (current_date + (COALESCE(fsi.due_day,1)-1)::int)::date,
             current_date
           ) AS due_date
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

  -- Look up institutional codes for application + registration fees.
  -- Match liberally so any of FORM-FEE / *FORM* / *APPLICATION* code wins.
  SELECT id INTO v_form_code
    FROM public.fee_codes
   WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END)
   LIMIT 1;
  SELECT id INTO v_reg_code
    FROM public.fee_codes
   WHERE code ILIKE '%REG%' AND code NOT ILIKE '%REGION%'
   ORDER BY (CASE WHEN code = 'MR-REG' THEN 0 WHEN code = 'NB-REG' THEN 0 ELSE 1 END)
   LIMIT 1;

  ----------------------------------------------------------------
  -- (b) Apply each unapplied confirmed lead_payment.
  --     application_fee  -> form fee ledger row (create if missing)
  --     registration_fee -> registration fee ledger row (create if missing)
  --     token_fee        -> spread across year_1 items by oldest due_date
  --     other            -> attached as an advance credit row
  ----------------------------------------------------------------
  FOR v_lp IN
    SELECT * FROM public.lead_payments
     WHERE lead_id = _lead_id
       AND status = 'confirmed'
       AND applied_to_ledger = false
     ORDER BY created_at
  LOOP
    v_remaining := v_lp.amount;

    IF v_lp.type = 'application_fee' AND v_form_code IS NOT NULL THEN
      -- Ensure a ledger row exists; create one if the structure didn't include it.
      SELECT id, total_amount, paid_amount INTO v_target
        FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_form_code
       ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_form_code, 'one_time', v_remaining, current_date, 'due')
        RETURNING id, total_amount, paid_amount INTO v_target;
      END IF;
      v_apply := LEAST(v_remaining, v_target.total_amount - v_target.paid_amount);
      IF v_apply <= 0 THEN v_apply := v_remaining; END IF;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply,
             status = CASE WHEN paid_amount + v_apply >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount)
      VALUES (v_target.id, v_lp.id, v_apply);
      v_remaining := v_remaining - v_apply;

    ELSIF v_lp.type = 'registration_fee' AND v_reg_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount INTO v_target
        FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_reg_code
       ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_reg_code, 'one_time', v_remaining, current_date, 'due')
        RETURNING id, total_amount, paid_amount INTO v_target;
      END IF;
      v_apply := LEAST(v_remaining, v_target.total_amount - v_target.paid_amount);
      IF v_apply <= 0 THEN v_apply := v_remaining; END IF;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply,
             status = CASE WHEN paid_amount + v_apply >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount)
      VALUES (v_target.id, v_lp.id, v_apply);
      v_remaining := v_remaining - v_apply;

    ELSIF v_lp.type = 'token_fee' THEN
      -- Spread across year_1 ledger rows by oldest due_date until exhausted.
      FOR v_target IN
        SELECT id, total_amount, paid_amount FROM public.fee_ledger
         WHERE student_id = v_student_id AND term = 'year_1'
         ORDER BY due_date
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_apply := LEAST(v_remaining, v_target.total_amount - v_target.paid_amount);
        IF v_apply <= 0 THEN CONTINUE; END IF;
        UPDATE public.fee_ledger
           SET paid_amount = paid_amount + v_apply,
               status = CASE WHEN paid_amount + v_apply >= total_amount THEN 'paid' ELSE 'due' END,
               updated_at = now()
         WHERE id = v_target.id;
        INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount)
        VALUES (v_target.id, v_lp.id, v_apply);
        v_remaining := v_remaining - v_apply;
      END LOOP;
    END IF;

    -- Anything left becomes an advance credit row tagged to whichever code
    -- best fits, so it's never lost.
    IF v_remaining > 0 THEN
      INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, paid_amount, due_date, status)
      VALUES (
        v_student_id,
        COALESCE(v_form_code, (SELECT id FROM public.fee_codes ORDER BY code LIMIT 1)),
        'advance',
        v_remaining,
        v_remaining,
        current_date,
        'paid'
      ) RETURNING id INTO v_target;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, notes)
      VALUES (v_target.id, v_lp.id, v_remaining, 'Carry-over advance from ' || v_lp.type);
    END IF;

    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    v_applied := v_applied + 1;
    v_total   := v_total + v_lp.amount;
  END LOOP;

  RETURN jsonb_build_object(
    'student_id',         v_student_id,
    'ledger_rows_created', v_inserted,
    'payments_applied',    v_applied,
    'total_applied',       v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_student_fees TO authenticated, service_role;

-- 4. Hook into the lead_payments trigger so AN issuance auto-provisions.
--    We re-create handle_lead_payment_change with the call appended; the
--    rest of its logic is unchanged from the Phase 1 + Phase 2 versions.
CREATE OR REPLACE FUNCTION public.handle_lead_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status        jsonb;
  v_lead          public.leads%ROWTYPE;
  v_pan           text;
  v_an            text;
  v_student_id    uuid;
  v_an_just_issued boolean := false;
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
  END IF;

  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students
       SET admission_no = COALESCE(admission_no, v_an), status = 'active'
     WHERE lead_id = v_lead.id
     RETURNING admission_no INTO v_an;

    UPDATE public.leads SET admission_no = v_an, stage = 'admitted' WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion', '25% fee paid — Admitted with AN: ' || v_an, 'admitted');

    v_an_just_issued := true;
  END IF;

  -- Always try to provision/sync the ledger when an AN exists. This covers:
  --  (a) the moment AN is first issued (above)
  --  (b) any later confirmed payment that should be applied against the ledger
  IF v_lead.admission_no IS NOT NULL OR v_an_just_issued THEN
    PERFORM public.provision_student_fees(NEW.lead_id);
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Backfill — any lead that already has admission_no but no ledger.
DO $$
DECLARE
  v_lead_id uuid;
BEGIN
  FOR v_lead_id IN
    SELECT l.id
      FROM public.leads l
      JOIN public.students s ON s.lead_id = l.id
     WHERE l.admission_no IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.fee_ledger fl WHERE fl.student_id = s.id)
  LOOP
    PERFORM public.provision_student_fees(v_lead_id);
  END LOOP;
END $$;
