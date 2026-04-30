-- ====================================================================
-- Token Fee Engine — Phase 1
--   1. Add session_id to leads so fee_structure can be locked at offer time
--   2. Global sequential receipt numbering (N1, N2, ...) — unique across
--      NIMT / NIMT School / Mirai
--   3. Functions: lead_first_year_fee(), lead_fee_status() — single source
--      of truth for "how much is owed / paid / what threshold has crossed"
--   4. AFTER-INSERT/UPDATE trigger on lead_payments that:
--        a) auto-numbers the receipt (receipt_no := next_receipt_no())
--        b) on full token paid → creates the student record + assigns PAN,
--           mirrors PAN onto the lead, sets stage='token_paid'
--        c) on 25%-of-first-year paid → assigns AN to the same student,
--           sets stage='admitted'
--      All steps are idempotent so a webhook retry can't double-issue.
-- ====================================================================

-- 1. session_id on leads --------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.admission_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_session ON public.leads(session_id);

COMMENT ON COLUMN public.leads.session_id IS
  'Admission session locked in at offer-letter time. Drives which fee_structure applies.';

-- 2. Global receipt sequence ---------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.receipt_no_seq START 1 MINVALUE 1;

CREATE OR REPLACE FUNCTION public.next_receipt_no()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'N' || nextval('public.receipt_no_seq')::text;
$$;

GRANT EXECUTE ON FUNCTION public.next_receipt_no TO authenticated, service_role;

-- 3a. First-year fee lookup ----------------------------------------------
-- Sums every fee_structure_item with term='year_1' for the lead's
-- course_id + session_id (the structure tied to the offer).
CREATE OR REPLACE FUNCTION public.lead_first_year_fee(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(fsi.amount), 0)::numeric
  FROM public.leads l
  JOIN public.fee_structures fs
    ON fs.course_id = l.course_id
   AND fs.session_id = l.session_id
   AND fs.is_active = true
  JOIN public.fee_structure_items fsi
    ON fsi.fee_structure_id = fs.id
   AND fsi.term = 'year_1'
  WHERE l.id = _lead_id;
$$;

GRANT EXECUTE ON FUNCTION public.lead_first_year_fee TO authenticated, service_role;

-- 3b. Aggregate fee status ------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_fee_status(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_year      numeric := public.lead_first_year_fee(_lead_id);
  v_token_required  numeric;
  v_token_paid      numeric;
  v_app_paid        numeric;
  v_total_paid      numeric;
  v_25pct           numeric;
BEGIN
  v_token_required := ROUND(v_first_year * 0.10, 2);
  v_25pct          := ROUND(v_first_year * 0.25, 2);

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'token_fee'       AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee') AND status = 'confirmed'), 0)
  INTO v_token_paid, v_app_paid, v_total_paid
  FROM public.lead_payments
  WHERE lead_id = _lead_id;

  RETURN jsonb_build_object(
    'first_year_fee',     v_first_year,
    'token_required',     v_token_required,
    'token_paid',         v_token_paid,
    'application_paid',   v_app_paid,
    'total_paid',         v_total_paid,
    'twenty_five_pct',    v_25pct,
    'token_complete',     (v_first_year > 0 AND v_token_paid >= v_token_required),
    'twenty_five_complete', (v_first_year > 0 AND v_total_paid >= v_25pct)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_status TO authenticated, service_role;

-- 4. Trigger function: auto-number + auto-advance -----------------------------
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
BEGIN
  -- (a) Stamp a sequential receipt_no on insert if not supplied.
  IF (TG_OP = 'INSERT') AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
    -- Re-store the change since we're using BEFORE INSERT for this part.
    -- (This trigger is split: BEFORE for numbering, AFTER for advancement.)
    RETURN NEW;
  END IF;

  -- (b) Stage advancement runs only when status is/becomes 'confirmed'.
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_status := public.lead_fee_status(NEW.lead_id);

  -- ---- Token complete: issue PAN + create student row -------------------
  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    -- Reuse an existing student row keyed by lead_id if one is somehow there;
    -- otherwise insert a fresh one.
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

    UPDATE public.leads
       SET pre_admission_no = v_pan,
           stage = 'token_paid'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            'Token fee complete — Pre-admitted with PAN: ' || v_pan,
            'token_paid');

    -- Refresh local row for the next branch.
    SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  END IF;

  -- ---- 25% threshold: issue AN, mark admitted -------------------------------
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students
       SET admission_no = COALESCE(admission_no, v_an),
           status = 'active'
     WHERE lead_id = v_lead.id
     RETURNING admission_no INTO v_an;

    UPDATE public.leads
       SET admission_no = v_an,
           stage = 'admitted'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            '25% fee paid — Admitted with AN: ' || v_an,
            'admitted');
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE: receipt numbering (mutates NEW)
DROP TRIGGER IF EXISTS lead_payments_assign_receipt_no ON public.lead_payments;
CREATE TRIGGER lead_payments_assign_receipt_no
BEFORE INSERT ON public.lead_payments
FOR EACH ROW
WHEN (NEW.receipt_no IS NULL OR NEW.receipt_no = '')
EXECUTE FUNCTION public.handle_lead_payment_change();

-- AFTER: stage / PAN / AN advancement
DROP TRIGGER IF EXISTS lead_payments_auto_advance ON public.lead_payments;
CREATE TRIGGER lead_payments_auto_advance
AFTER INSERT OR UPDATE OF status, amount ON public.lead_payments
FOR EACH ROW
WHEN (NEW.status = 'confirmed')
EXECUTE FUNCTION public.handle_lead_payment_change();
