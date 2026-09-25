-- Hiring Phase A — make the existing recruitment objects usable end-to-end:
--   * richer job_applicants_inbox (notes, rating, stage time, source, opening)
--   * atomic stage moves (move_job_applicant) and assignment
--   * atomic interview scheduling (schedule_job_interview) with interviewer/panel
--   * offer generation moves the applicant to `offered`
-- Comms (email/WhatsApp) are handled by the new `hiring-notify` edge function.

-- ── 1. Richer applicant inbox ───────────────────────────────────────────────

DROP VIEW IF EXISTS public.job_applicants_inbox;
CREATE VIEW public.job_applicants_inbox AS -- lint-allow: HR-only inbox; the LEFT JOIN to leads only nulls l.email for roles without leads RLS, it never drops applicant rows
SELECT
  ja.id,
  ja.lead_id,
  ja.status,
  ja.name,
  ja.source_phone           AS phone,
  ja.desired_role,
  ja.experience_years,
  ja.resume_url,
  ja.classification_source,
  ja.ai_intent,
  ja.ai_confidence,
  ja.ai_reasoning,
  ja.assigned_to,
  ja.notes,
  ja.rating,
  ja.stage_changed_at,
  ja.job_opening_id,
  ja.applied_via,
  ja.cover_note,
  ja.source_channel,
  ja.source_message_id,
  ja.first_message_at,
  ja.last_message_at,
  ja.created_at,
  ja.updated_at,
  COALESCE(ja.email, l.email) AS email,
  l.source                  AS lead_source,
  jo.title                  AS job_opening_title,
  (SELECT content FROM public.whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound'
     ORDER BY wm.created_at DESC LIMIT 1) AS last_message_preview,
  (SELECT count(*) FROM public.whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound') AS inbound_message_count,
  prof.display_name         AS assigned_to_name
FROM public.job_applicants ja
LEFT JOIN public.leads l        ON l.id = ja.lead_id
LEFT JOIN public.job_openings jo ON jo.id = ja.job_opening_id
LEFT JOIN public.profiles prof  ON prof.user_id = ja.assigned_to;

ALTER VIEW public.job_applicants_inbox SET (security_invoker = true);
GRANT SELECT ON public.job_applicants_inbox TO authenticated;

-- ── 2. Stage moves (atomic, audited) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.move_job_applicant(
  _applicant_id uuid, _status text, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a public.job_applicants;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:recruitment_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _status NOT IN ('new','reviewing','shortlisted','interview','offered','rejected','hired','withdrawn') THEN
    RAISE EXCEPTION 'Unknown applicant status: %', _status;
  END IF;

  SELECT * INTO a FROM public.job_applicants WHERE id = _applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;

  UPDATE public.job_applicants
     SET status = _status, notes = COALESCE(_note, notes)
   WHERE id = _applicant_id;

  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (_applicant_id, auth.uid(), 'stage',
          'Moved ' || a.status || ' → ' || _status || COALESCE(' · ' || _note, ''));

  RETURN _status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.move_job_applicant(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_job_applicant(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assign_job_applicant(_applicant_id uuid, _user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:recruitment_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.job_applicants SET assigned_to = _user_id WHERE id = _applicant_id;
  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (_applicant_id, auth.uid(), 'assign',
          CASE WHEN _user_id IS NULL THEN 'Unassigned' ELSE 'Assigned to a recruiter' END);
  RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_job_applicant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_job_applicant(uuid, uuid) TO authenticated, service_role;

-- ── 3. Atomic interview scheduling ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.schedule_job_interview(
  _applicant_id uuid,
  _scheduled_at timestamptz,
  _mode text DEFAULT 'in_person',
  _location text DEFAULT NULL,
  _meeting_link text DEFAULT NULL,
  _interviewer_id uuid DEFAULT NULL,
  _panel uuid[] DEFAULT '{}'::uuid[],
  _duration_mins smallint DEFAULT 30,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:interviews_edit')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _scheduled_at IS NULL THEN RAISE EXCEPTION 'Interview time is required'; END IF;

  INSERT INTO public.interviews
    (job_applicant_id, scheduled_at, mode, location, meeting_link, interviewer_id, panel, duration_mins, notes, created_by)
  VALUES
    (_applicant_id, _scheduled_at, COALESCE(_mode, 'in_person'), _location, _meeting_link,
     _interviewer_id, COALESCE(_panel, '{}'::uuid[]), COALESCE(_duration_mins, 30), _notes, auth.uid())
  RETURNING id INTO v_id;

  -- Keep the stage in step in the SAME transaction (the old UI could leave them
  -- inconsistent if the second write failed).
  UPDATE public.job_applicants
     SET status = 'interview'
   WHERE id = _applicant_id AND status NOT IN ('hired', 'rejected', 'withdrawn');

  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (_applicant_id, auth.uid(), 'interview_scheduled', 'Interview scheduled');

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_job_interview(uuid, timestamptz, text, text, text, uuid, uuid[], smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_job_interview(uuid, timestamptz, text, text, text, uuid, uuid[], smallint, text) TO authenticated, service_role;

-- ── 4. Offer generation moves the applicant to `offered` ────────────────────

CREATE OR REPLACE FUNCTION public.generate_hr_offer_letter(_job_applicant_id uuid, _details jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.hr_letter_templates; a public.job_applicants;
  txt text; sub text; v_id uuid; v_super boolean;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:documents_generate')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  v_super := public.has_role(auth.uid(), 'super_admin'::public.app_role);

  SELECT * INTO t FROM public.hr_letter_templates WHERE code = 'offer' AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer letter template not found'; END IF;
  SELECT * INTO a FROM public.job_applicants WHERE id = _job_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;

  txt := t.body; sub := COALESCE(t.subject, t.name);
  txt := replace(txt, '{{applicant_name}}', COALESCE(a.name, ''));
  txt := replace(txt, '{{offered_role}}',   COALESCE(_details->>'offered_role', a.desired_role, ''));
  txt := replace(txt, '{{offered_ctc}}',    COALESCE(_details->>'offered_ctc', ''));
  txt := replace(txt, '{{joining_date}}',   COALESCE(_details->>'joining_date', ''));
  txt := replace(txt, '{{legal_entity}}',   COALESCE(_details->>'legal_entity', ''));
  txt := replace(txt, '{{today}}',          to_char(CURRENT_DATE, 'DD Mon YYYY'));
  sub := replace(sub, '{{applicant_name}}', COALESCE(a.name, ''));

  INSERT INTO public.hr_letters (
    job_applicant_id, template_id, letter_code, letter_name, subject, body,
    reference_no, issued_by, status, submitted_by, submitted_at, approved_by, approved_at
  ) VALUES (
    a.id, t.id, t.code, t.name, sub, txt,
    'HR/OFR/' || to_char(CURRENT_DATE, 'YYYY') || '/' || left(a.id::text, 6),
    auth.uid(),
    CASE WHEN v_super THEN 'approved' ELSE 'pending_approval' END,
    auth.uid(), now(),
    CASE WHEN v_super THEN auth.uid() ELSE NULL END,
    CASE WHEN v_super THEN now() ELSE NULL END
  ) RETURNING id INTO v_id;

  -- An offer letter means the candidate has been offered the role.
  IF a.status NOT IN ('hired', 'rejected', 'withdrawn') THEN
    UPDATE public.job_applicants SET status = 'offered' WHERE id = a.id;
    INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
    VALUES (a.id, auth.uid(), 'stage', 'Offer letter generated (offered)');
  END IF;

  PERFORM public.log_hr_document_action(v_id, 'generated', jsonb_build_object('applicant', a.name));
  IF NOT v_super THEN
    PERFORM public.notify_super_admins_hr_document(
      v_id, 'Offer letter pending approval',
      'Offer letter for ' || COALESCE(a.name, 'applicant') || ' awaits approval.');
    PERFORM public.log_hr_document_action(v_id, 'submitted', '{}'::jsonb);
  END IF;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_hr_offer_letter(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_hr_offer_letter(uuid, jsonb) TO authenticated, service_role;
