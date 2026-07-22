-- Widen the PAN-promotion stage guard in recompute_lead_fee_stage().
--
-- Bug: candidates who paid their full first-year fee (token_complete +
-- twenty_five_complete both true) were left stuck at "token_paid" in the
-- application funnel — no PAN, no AN — because recompute_lead_fee_stage()
-- only issued a PAN when the lead's stage was one of
-- ('offer_sent','counsellor_call','visit_scheduled','interview').
--
-- A lead can legitimately be sitting in an application_* stage while already
-- holding an offer and having paid in full: e.g. APP-26-8254 (ANSHIKA PANDEY)
-- had her stage reset from counsellor_call to application_in_progress by a
-- "database audit" the day before she paid. At payment time the whitelist
-- rejected her, so no PAN/AN was issued and both promotions silently no-op'd.
--
-- token_complete already implies an offer exists (lead_first_year_fee()=0
-- before an offer, so the completion flags can't be true pre-offer). The
-- application_* stages are therefore safe to promote from — add them. The
-- pre_admission_no IS NULL guard still prevents double-issue, and terminal /
-- dead stages (not_interested, lost, …) remain excluded.
--
-- Body is otherwise verbatim from 20260707120000_payment_links_and_pre_admission_token.sql.
CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)
RETURNS void
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
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := public.lead_fee_status(_lead_id);

  -- Token complete: PAN + student row + notify pan_issued -----------------
  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview',
                          'application_in_progress','application_fee_paid','application_submitted') THEN

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

    SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  END IF;

  -- 25% threshold: AN + magic token --------------------------------------
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_has_rejected_doc(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'AN provisioning blocked — one or more documents are rejected. Resolve rejections to issue AN.');
      RETURN;
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_lead_fee_stage(uuid) TO authenticated, service_role;

-- Backfill: promote the leads already stranded by the narrow guard —
-- offer exists, token complete, but no PAN and still in an application_* stage.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT l.id
    FROM public.leads l
    WHERE l.pre_admission_no IS NULL
      AND l.admission_no IS NULL
      AND l.stage IN ('application_in_progress','application_fee_paid','application_submitted')
      AND EXISTS (SELECT 1 FROM public.offer_letters o WHERE o.lead_id = l.id)
      AND (public.lead_fee_status(l.id)->>'token_complete')::boolean = true
  LOOP
    PERFORM public.recompute_lead_fee_stage(r.id);
  END LOOP;
END $$;
