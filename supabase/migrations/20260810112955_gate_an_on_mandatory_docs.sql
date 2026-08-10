-- Gate admission-number issuance on mandatory documents being verified.
--
-- Previously recompute_lead_fee_stage blocked the AN only when a document was
-- actively 'rejected' (lead_has_rejected_doc); a missing/unreviewed mandatory doc
-- still auto-issued. New rule: issue only when ALL mandatory required docs are
-- uploaded AND verified — surfaced as applications.mandatory_docs_complete, which
-- the sync-admission-doc-status edge function maintains. Blocked cases are logged,
-- notified to super_admin + principal, and shown in the Inbox; super_admin can
-- bypass via admission_bypass_generate_an().
--
-- The AN-stamping logic is extracted to fn_issue_admission_no() so both the gated
-- engine path and the super_admin bypass mint the AN identically.

-- ── Are the lead's documents ready for admission? ────────────────────────────
-- No application on file → nothing to gate on (walk-ins): preserve prior behavior.
CREATE OR REPLACE FUNCTION public.lead_docs_ready_for_admission(_lead_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.lead_id = _lead_id)
      THEN true
    ELSE EXISTS (SELECT 1 FROM public.applications a
                  WHERE a.lead_id = _lead_id AND a.mandatory_docs_complete)
  END;
$function$;

-- ── Idempotent AN issuance (single source of truth) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_issue_admission_no(_lead_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead       public.leads%ROWTYPE;
  v_an         text;
  v_student_id uuid;
  v_token      text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.pre_admission_no IS NULL THEN RETURN NULL; END IF;             -- not pre-admitted yet
  IF v_lead.admission_no IS NOT NULL THEN RETURN v_lead.admission_no; END IF;  -- already issued

  v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

  UPDATE public.students SET admission_no = COALESCE(admission_no, v_an), status = 'active'
   WHERE lead_id = v_lead.id RETURNING admission_no, id INTO v_an, v_student_id;

  UPDATE public.leads SET admission_no = v_an, stage = 'admitted' WHERE id = v_lead.id;

  INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
  VALUES (v_lead.id, 'conversion', '25% fee paid — Admitted with AN: ' || v_an, 'admitted');

  IF v_student_id IS NOT NULL THEN
    INSERT INTO public.student_magic_tokens (student_id, lead_id, phone, email, expires_at)
    VALUES (v_student_id, v_lead.id, v_lead.phone, v_lead.email, now() + interval '30 days')
    RETURNING token INTO v_token;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (v_lead.id, 'system', 'Student-portal claim link generated (valid 30 days).');
  END IF;

  RETURN v_an;
END;
$function$;

-- ── Notify super_admin + principal when a paid student is doc-blocked ─────────
CREATE OR REPLACE FUNCTION public.notify_pending_an_generation(_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_name text;
BEGIN
  -- Fire once per lead per block episode (unread, or first-seen in the last 3 days).
  IF EXISTS (
    SELECT 1 FROM public.notifications
     WHERE lead_id = _lead_id AND type = 'an_pending_docs'
       AND (is_read = false OR created_at > now() - interval '3 days')
  ) THEN
    RETURN;
  END IF;

  SELECT name INTO v_name FROM public.leads WHERE id = _lead_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
  SELECT ur.user_id, 'an_pending_docs',
         'Admission number pending — documents',
         COALESCE(v_name, 'A student') || ' has paid the fee but the admission number is held until mandatory documents are verified.',
         '/inbox', _lead_id
    FROM public.user_roles ur
   WHERE ur.role IN ('super_admin', 'principal');
END;
$function$;

-- ── Swap the doc gate inside recompute_lead_fee_stage ─────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status        jsonb;
  v_lead          public.leads%ROWTYPE;
  v_pan           text;
  v_student_id    uuid;
  v_is_school     boolean;
  v_session_name  text;
  v_st            text;
  v_ht            text;
  v_tz            text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := public.lead_fee_status(_lead_id);

  SELECT student_type, hostel_type, transport_zone
    INTO v_st, v_ht, v_tz
    FROM public.offer_letters
   WHERE lead_id = _lead_id AND approval_status = 'approved'
   ORDER BY created_at DESC LIMIT 1;

  -- Token complete: PAN + student row + notify pan_issued -----------------
  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview',
                          'application_in_progress','application_fee_paid','application_submitted') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_lead.id;
    IF v_student_id IS NULL THEN
      v_is_school := public.student_course_is_school(v_lead.course_id);

      IF v_is_school THEN
        SELECT name INTO v_session_name FROM public.admission_sessions WHERE id = v_lead.session_id;

        INSERT INTO public.students (
          name, phone, email, guardian_name, guardian_phone,
          course_id, campus_id, lead_id, session_id,
          pre_admission_no, status,
          admission_date, joining_academic_year,
          student_type, hostel_type, transport_zone, transport_required
        ) VALUES (
          v_lead.name, v_lead.phone, v_lead.email,
          v_lead.guardian_name, v_lead.guardian_phone,
          v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
          v_pan, 'pre_admitted',
          CURRENT_DATE, COALESCE(v_session_name, to_char(CURRENT_DATE, 'YYYY')),
          COALESCE(v_st, 'day_scholar'), v_ht, v_tz, (v_tz IS NOT NULL)
        ) RETURNING id INTO v_student_id;
      ELSE
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
      END IF;
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

    PERFORM public.fn_notify_event('pan_issued', v_lead.id, jsonb_build_object('pre_admission_no', v_pan));

    SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  END IF;

  -- Keep the school student's fee mode in sync with the approved offer.
  IF public.student_course_is_school(v_lead.course_id) THEN
    UPDATE public.students
       SET student_type      = COALESCE(v_st, student_type, 'day_scholar'),
           hostel_type        = v_ht,
           transport_zone     = v_tz,
           transport_required = (v_tz IS NOT NULL)
     WHERE lead_id = v_lead.id;
  END IF;

  -- 25% threshold: AN + magic token, gated on mandatory documents -----------
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF NOT public.lead_docs_ready_for_admission(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'AN pending — mandatory documents are not all verified. See Inbox → Pending AN Generation.');
      PERFORM public.notify_pending_an_generation(v_lead.id);
      RETURN;
    END IF;

    PERFORM public.fn_issue_admission_no(v_lead.id);
  END IF;
END;
$function$;

-- ── Retire the interim doc-review trigger; the sync edge fn now orchestrates ──
DROP TRIGGER IF EXISTS trg_recompute_stage_on_doc_review ON public.application_doc_reviews;
DROP FUNCTION IF EXISTS public.tg_recompute_stage_on_doc_review();
