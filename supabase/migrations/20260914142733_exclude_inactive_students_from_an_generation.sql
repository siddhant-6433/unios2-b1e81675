-- Archived, deleted, or login-disabled students must not sit in
-- Pending AN Generation and must not receive an admission number.

CREATE OR REPLACE FUNCTION public.lead_excluded_from_an_generation(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.students s
     WHERE s.lead_id = _lead_id
       AND (
         COALESCE(s.login_disabled, false)
         OR s.archived_at IS NOT NULL
         OR s.deleted_at IS NOT NULL
       )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.list_pending_an_generation()
RETURNS TABLE (
  lead_id uuid, student_id uuid, name text, course text,
  pre_admission_no text, application_id text, admission_doc_status jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin'::public.app_role)
          OR public.has_role(auth.uid(), 'principal'::public.app_role)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT l.id, s.id, s.name, c.name, s.pre_admission_no, a.application_id,
         CASE
           WHEN a.application_id IS NULL THEN a.admission_doc_status
           ELSE public.compute_application_admission_doc_status(a.application_id)
                || jsonb_build_object(
                     'held', COALESCE((a.admission_doc_status->>'held')::boolean, false)
                   )
         END
    FROM public.students s
    JOIN public.leads l ON l.id = s.lead_id
    LEFT JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN LATERAL (
      SELECT ap.application_id, ap.admission_doc_status
        FROM public.applications ap
       WHERE ap.lead_id = l.id
       ORDER BY ap.created_at DESC NULLS LAST
       LIMIT 1
    ) a ON true
   WHERE s.pre_admission_no IS NOT NULL
     AND s.admission_no IS NULL
     AND s.archived_at IS NULL
     AND s.deleted_at IS NULL
     AND NOT COALESCE(s.login_disabled, false)
     AND NOT public.lead_docs_ready_for_admission(l.id)
     AND (public.lead_fee_status(l.id)->>'twenty_five_complete')::boolean
   ORDER BY s.name;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_issue_admission_no(_lead_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lead       public.leads%ROWTYPE;
  v_an         text;
  v_student_id uuid;
  v_token      text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.pre_admission_no IS NULL THEN RETURN NULL; END IF;
  IF v_lead.admission_no IS NOT NULL THEN RETURN v_lead.admission_no; END IF;
  IF public.lead_excluded_from_an_generation(_lead_id) THEN
    RAISE EXCEPTION 'Cannot generate AN: student is archived, deleted, or login-disabled';
  END IF;

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

  UPDATE public.applications
     SET admission_doc_status = COALESCE(admission_doc_status, '{}'::jsonb)
                                || jsonb_build_object('held', false)
   WHERE lead_id = v_lead.id
     AND COALESCE((admission_doc_status->>'held')::boolean, false);

  RETURN v_an;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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

  IF public.student_course_is_school(v_lead.course_id) THEN
    UPDATE public.students
       SET student_type      = COALESCE(v_st, student_type, 'day_scholar'),
           hostel_type        = v_ht,
           transport_zone     = v_tz,
           transport_required = (v_tz IS NOT NULL)
     WHERE lead_id = v_lead.id;
  END IF;

  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_excluded_from_an_generation(v_lead.id) THEN
      RETURN;
    END IF;

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
$fn$;

CREATE OR REPLACE VIEW public.pending_approvals AS
 SELECT 'concession'::text AS kind, (c.id)::text AS id, c.status,
    (c.student_id)::text AS subject_id, s.name AS subject_name,
    c.type AS detail_type, c.value AS detail_value, c.reason,
    (c.requested_by)::text AS requested_by_id, c.created_at,
    CASE WHEN (c.status = 'pending_principal'::text) THEN 'principal'::text
         WHEN (c.status = 'pending_super_admin'::text) THEN 'super_admin'::text
         ELSE NULL::text END AS pending_role
   FROM (concessions c LEFT JOIN students s ON ((s.id = c.student_id)))
  WHERE (c.status = ANY (ARRAY['pending_principal'::text, 'pending_super_admin'::text]))
UNION ALL
 SELECT 'offer_letter'::text, (ol.id)::text, ol.approval_status, (ol.lead_id)::text, l.name,
    'flat'::text, ol.net_fee, NULL::text, (ol.issued_by)::text, ol.created_at, 'principal'::text
   FROM (offer_letters ol LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (ol.approval_status = 'pending_principal'::text)
UNION ALL
 SELECT 'offer_edit'::text, (er.id)::text, er.status, (ol.lead_id)::text, l.name,
    'edit_request'::text, NULL::numeric, er.reason, (er.requested_by)::text, er.created_at, 'super_admin'::text
   FROM ((offer_letter_edit_requests er
     JOIN offer_letters ol ON ((ol.id = er.offer_letter_id)))
     LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (er.status = 'pending'::text)
UNION ALL
 SELECT 'student_contact_change'::text, (scr.id)::text, scr.status, (scr.student_id)::text, s.name,
    scr.field_name, NULL::numeric, scr.reason, (scr.requested_by)::text, scr.created_at, 'principal'::text
   FROM (student_contact_change_requests scr LEFT JOIN students s ON ((s.id = scr.student_id)))
  WHERE (scr.status = 'pending'::text)
UNION ALL
 SELECT 'lead_deletion'::text, (ldr.id)::text, 'pending_admin'::text, (ldr.lead_id)::text, l.name,
    ldr.reason, NULL::numeric, ldr.custom_message, (ldr.requested_by)::text, ldr.created_at, 'super_admin'::text
   FROM (lead_deletion_requests ldr LEFT JOIN leads l ON ((l.id = ldr.lead_id)))
  WHERE (ldr.status = 'pending'::text)
UNION ALL
 SELECT 'pending_an'::text, (l.id)::text, 'pending'::text, (s.id)::text, s.name,
    'pending_an'::text, NULL::numeric, NULL::text, NULL::text, s.updated_at, 'principal'::text
   FROM (students s JOIN leads l ON ((l.id = s.lead_id)))
  WHERE s.pre_admission_no IS NOT NULL
    AND s.admission_no IS NULL
    AND s.archived_at IS NULL
    AND s.deleted_at IS NULL
    AND NOT COALESCE(s.login_disabled, false)
    AND NOT public.lead_docs_ready_for_admission(l.id)
    AND (public.lead_fee_status(l.id)->>'twenty_five_complete')::boolean;

GRANT EXECUTE ON FUNCTION public.lead_excluded_from_an_generation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_an_generation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_issue_admission_no(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_lead_fee_stage(uuid) TO authenticated;
