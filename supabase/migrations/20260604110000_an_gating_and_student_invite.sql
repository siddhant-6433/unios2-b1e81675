-- AN gating + student auto-invite at AN issuance.
--
-- Conservative gating philosophy: token-fee flow (PAN issuance, student row
-- creation, stage='token_paid') stays untouched. AN auto-issues on 25%-paid
-- threshold UNLESS an admin has explicitly rejected a document. Pending or
-- unreviewed docs do NOT block — otherwise AN provisioning becomes a
-- bottleneck waiting on every doc review, which would mean cash collected
-- but no AN issued.
--
-- The admin approve/reject workflow lives alongside this as a tracking
-- signal (applications.approved_at, rejection_reason) but is intentionally
-- NOT a hard gate on AN. If you want stricter gating later, add a check on
-- application.approved_at IS NOT NULL inside the IF below.

-- Helper: does any doc on this lead's submitted application have status='rejected'?
CREATE OR REPLACE FUNCTION public.lead_has_rejected_doc(_lead_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.application_doc_reviews r ON r.application_id = a.application_id
    WHERE a.lead_id = _lead_id
      AND r.status = 'rejected'
  );
$$;

GRANT EXECUTE ON FUNCTION public.lead_has_rejected_doc TO authenticated, service_role;

-- Rebuild the AN-issuing portion of handle_lead_payment_change.
-- The function is reproduced in full to preserve the BEFORE-INSERT receipt
-- numbering branch and the token→PAN→student creation branch unchanged;
-- only the AN branch gains a guard call to lead_has_rejected_doc().
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
  v_token         text;
BEGIN
  -- (a) BEFORE-INSERT receipt numbering — unchanged from the original
  -- token_fee_engine migration. Returns early so the AFTER branch logic
  -- doesn't run on the same trigger pass.
  IF (TG_OP = 'INSERT') AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
    RETURN NEW;
  END IF;

  -- (b) Stage advancement only on confirmed payments.
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_status := public.lead_fee_status(NEW.lead_id);

  -- ---- Token complete: issue PAN + create student row ---------------------
  -- UNTOUCHED from the original migration. Token-fee flow is the cash-in
  -- moment we never want to block.
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

    UPDATE public.leads
       SET pre_admission_no = v_pan,
           stage = 'token_paid'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            'Token fee complete — Pre-admitted with PAN: ' || v_pan,
            'token_paid');

    SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  END IF;

  -- ---- 25% threshold: issue AN, mark admitted -----------------------------
  -- NEW: skip if any doc is explicitly rejected. Pending docs DO NOT block.
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_has_rejected_doc(v_lead.id) THEN
      -- Log once per payment event; surfaces in lead timeline so admin sees
      -- the lead is at AN-ready threshold but blocked.
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'AN provisioning blocked — one or more documents are rejected. Resolve rejections to issue AN.');
      RETURN NEW;
    END IF;

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students
       SET admission_no = COALESCE(admission_no, v_an),
           status = 'active'
     WHERE lead_id = v_lead.id
     RETURNING admission_no, id INTO v_an, v_student_id;

    UPDATE public.leads
       SET admission_no = v_an,
           stage = 'admitted'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            '25% fee paid — Admitted with AN: ' || v_an,
            'admitted');

    -- NEW: mint a single-use student-portal magic token. The student-invite
    -- edge function (called by a separate cron or from this row insertion via
    -- a notify channel) handles the actual WhatsApp/email send so we don't
    -- inline pg_net inside the AN trigger.
    IF v_student_id IS NOT NULL THEN
      INSERT INTO public.student_magic_tokens (
        student_id, lead_id, phone, email, expires_at
      ) VALUES (
        v_student_id, v_lead.id, v_lead.phone, v_lead.email,
        now() + interval '30 days'
      )
      RETURNING token INTO v_token;

      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'Student-portal claim link generated (valid 30 days).');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Triggers were created in 20260515300000_token_fee_engine.sql and reference
-- handle_lead_payment_change() by name, so CREATE OR REPLACE above is enough
-- — no DROP/CREATE TRIGGER needed.
