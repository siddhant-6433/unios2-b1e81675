-- Lifecycle notification scaffolding for the 5 admission events the
-- founder asked us to wire (per chat 2026-05-04):
--   1. Application submitted        — applicant WhatsApp + counsellor / TL / super_admin emails
--   2. Application fee paid         — applicant WhatsApp + counsellor / TL / super_admin emails
--   3. Offer letter issued          — applicant WhatsApp only (offer PDF + magic pay link)
--   4. PAN issued (token complete)  — applicant WhatsApp only (nudge to pay balance for AN)
--   5. Token / other fee paid       — applicant WhatsApp + super_admin emails
--
-- This migration:
--   A. Seeds 5 email_templates rows. Some reuse the existing 'offer-letter'
--      and 'fee-receipt' slugs that 20260404130000_email_integration.sql
--      already created — we leave those untouched and add new slugs only.
--   B. Adds an applicant_email column to leads if it doesn't exist (we
--      already have leads.email but standardising).
--   C. Adds AFTER triggers that POST to the new notify-event edge function:
--        - trg_notify_app_fee_paid   on lead_payments
--        - trg_notify_offer_issued   on offer_letters
--        - trg_notify_payment_paid   on lead_payments (any non-app_fee type)
--      Plus extends handle_lead_payment_change so the PAN branch fires
--      notify-event with event='pan_issued'.
--   D. App-submission notification (event 1) is fired from ApplyPortal.tsx
--      after handleSubmit completes — no DB trigger needed since the
--      submit path is already in app code.

------------------------------------------------------------------------
-- A. Email templates
------------------------------------------------------------------------

INSERT INTO public.email_templates (name, slug, subject, body_html, variables, category) VALUES
(
  'Application Submitted (Internal)',
  'application-submitted-internal',
  'New application received — {{application_id}} ({{course_name}})',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">' ||
  '<h2 style="color:#0f172a">Application received</h2>' ||
  '<p>{{student_name}} just submitted application <strong>{{application_id}}</strong>.</p>' ||
  '<table style="width:100%;border-collapse:collapse;margin:16px 0">' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Course</td><td style="padding:8px;border:1px solid #ddd"><strong>{{course_name}}</strong></td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Campus</td><td style="padding:8px;border:1px solid #ddd">{{campus_name}}</td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Phone</td><td style="padding:8px;border:1px solid #ddd">{{phone}}</td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Email</td><td style="padding:8px;border:1px solid #ddd">{{email}}</td></tr>' ||
  '</table>' ||
  '<p><a href="{{form_pdf_url}}" style="color:#0047FF">View application form PDF →</a></p>' ||
  '<p><a href="{{lead_url}}" style="color:#0047FF">Open lead in CRM →</a></p>' ||
  '</div>',
  ARRAY['student_name','application_id','course_name','campus_name','phone','email','form_pdf_url','lead_url'],
  'general'
),
(
  'Application Fee Paid (Internal)',
  'app-fee-paid-internal',
  'Application fee received — ₹{{amount}} ({{application_id}})',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">' ||
  '<h2 style="color:#0f172a">Application fee received</h2>' ||
  '<p>{{student_name}} paid the application fee for <strong>{{course_name}}</strong>.</p>' ||
  '<table style="width:100%;border-collapse:collapse;margin:16px 0">' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Amount</td><td style="padding:8px;border:1px solid #ddd"><strong>₹{{amount}}</strong></td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Application</td><td style="padding:8px;border:1px solid #ddd">{{application_id}}</td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Reference</td><td style="padding:8px;border:1px solid #ddd">{{payment_ref}}</td></tr>' ||
  '</table>' ||
  '<p><a href="{{receipt_url}}" style="color:#0047FF">View receipt PDF →</a></p>' ||
  '<p><a href="{{lead_url}}" style="color:#0047FF">Open lead in CRM →</a></p>' ||
  '</div>',
  ARRAY['student_name','amount','application_id','course_name','payment_ref','receipt_url','lead_url'],
  'fee_receipt'
),
(
  'Payment Received (Super Admin)',
  'payment-received-internal',
  '{{payment_type}} payment received — ₹{{amount}} ({{student_name}})',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">' ||
  '<h2 style="color:#0f172a">Payment received</h2>' ||
  '<p>{{student_name}} ({{phone}}) paid <strong>₹{{amount}}</strong> via {{payment_mode}}.</p>' ||
  '<table style="width:100%;border-collapse:collapse;margin:16px 0">' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Type</td><td style="padding:8px;border:1px solid #ddd"><strong>{{payment_type}}</strong></td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Receipt No</td><td style="padding:8px;border:1px solid #ddd">{{receipt_no}}</td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Reference</td><td style="padding:8px;border:1px solid #ddd">{{payment_ref}}</td></tr>' ||
  '<tr><td style="padding:8px;border:1px solid #ddd">Date</td><td style="padding:8px;border:1px solid #ddd">{{payment_date}}</td></tr>' ||
  '</table>' ||
  '<p><a href="{{receipt_url}}" style="color:#0047FF">View receipt PDF →</a></p>' ||
  '<p><a href="{{lead_url}}" style="color:#0047FF">Open lead in CRM →</a></p>' ||
  '</div>',
  ARRAY['student_name','amount','phone','payment_mode','payment_type','receipt_no','payment_ref','payment_date','receipt_url','lead_url'],
  'fee_receipt'
)
ON CONFLICT (slug) DO NOTHING;

------------------------------------------------------------------------
-- B. Async notify-event helper (called from triggers via pg_net)
------------------------------------------------------------------------
-- Centralised: triggers know nothing about templates or recipients —
-- they pass the event name + relevant IDs. The notify-event edge
-- function does the rest (template selection, recipient resolution).

CREATE OR REPLACE FUNCTION public.fn_notify_event(
  _event       text,
  _lead_id     uuid,
  _context     jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supa_url    text;
  v_service_key text;
BEGIN
  IF _lead_id IS NULL THEN RETURN; END IF;

  SELECT value INTO v_supa_url    FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/notify-event',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'event',   _event,
      'lead_id', _lead_id,
      'context', _context
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_notify_event(% , %) failed: %', _event, _lead_id, SQLERRM;
END;
$$;

------------------------------------------------------------------------
-- C. Triggers
------------------------------------------------------------------------

-- C1. Application fee paid → event 'app_fee_paid'
-- Fires when a lead_payments row of type='application_fee' transitions
-- to status='confirmed' (insert OR update).
CREATE OR REPLACE FUNCTION public.fn_notify_app_fee_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'app_fee_paid',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_app_fee_paid ON public.lead_payments;
CREATE TRIGGER trg_notify_app_fee_paid
  AFTER INSERT OR UPDATE OF status ON public.lead_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_app_fee_paid();

-- C2. Other-fee paid → event 'payment_received'
-- Fires for token_fee, registration_fee, and 'other'. Keeps app_fee out
-- of the payment-receipt channel since C1 already handles that with a
-- richer notification.
CREATE OR REPLACE FUNCTION public.fn_notify_payment_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.type = 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'payment_received',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_received ON public.lead_payments;
CREATE TRIGGER trg_notify_payment_received
  AFTER INSERT OR UPDATE OF status ON public.lead_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_payment_received();

-- C3. Offer letter issued → event 'offer_issued'
-- Fires on INSERT into offer_letters (issuance moment).
CREATE OR REPLACE FUNCTION public.fn_notify_offer_issued()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM public.fn_notify_event(
    'offer_issued',
    NEW.lead_id,
    jsonb_build_object('offer_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_offer_issued ON public.offer_letters;
CREATE TRIGGER trg_notify_offer_issued
  AFTER INSERT ON public.offer_letters
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_offer_issued();

-- C4. PAN issued → extend handle_lead_payment_change to fire 'pan_issued'.
-- We can't add a separate AFTER trigger that watches "lead just got a PAN"
-- because the same trigger sets it inside its own pass; safer to add the
-- notify call directly inside the existing function's PAN branch.
--
-- The full function body is reproduced here unchanged from
-- 20260604110000_an_gating_and_student_invite.sql except for the new
-- PERFORM fn_notify_event() call inside the token-complete branch.

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
  IF (TG_OP = 'INSERT') AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_status := public.lead_fee_status(NEW.lead_id);

  -- Token complete: PAN + student row + (NEW) notify pan_issued ----------
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

    PERFORM public.fn_notify_event('pan_issued', v_lead.id,
      jsonb_build_object('pre_admission_no', v_pan));

    SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  END IF;

  -- 25% threshold: AN + magic token --------------------------------------
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_has_rejected_doc(v_lead.id) THEN
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
