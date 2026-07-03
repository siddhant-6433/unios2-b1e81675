-- PGDM diploma certificate generation and approval workflow for Student Services.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned',
  'sla_warning',
  'lead_reclaimed',
  'followup_due',
  'followup_overdue',
  'visit_confirmation_due',
  'visit_followup_due',
  'lead_transferred',
  'deletion_request',
  'whatsapp_message',
  'whatsapp_sla_warning',
  'whatsapp_sla_breach',
  'approval_pending',
  'approval_decided',
  'template_status_update',
  'tat_defaults_report',
  'post_visit_nudge',
  'score_penalty',
  'lead_bucket_backlog',
  'feedback_received',
  'campaign_completed',
  'student_service_assigned',
  'student_service_unassigned',
  'pgdm_certificate_pending',
  'pgdm_certificate_approved',
  'pgdm_diploma_ready',
  'general',
  'visit_due',
  'missed_call',
  'callback_requested'
));

ALTER TABLE public.alumni_verification_requests
  ADD COLUMN IF NOT EXISTS pgdm_certificate_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pgdm_certificate_status text NOT NULL DEFAULT 'not_started'
    CHECK (pgdm_certificate_status IN ('not_started', 'draft', 'pending_approval', 'approved', 'ready_notified')),
  ADD COLUMN IF NOT EXISTS pgdm_certificate_pdf_path text,
  ADD COLUMN IF NOT EXISTS pgdm_certificate_submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pgdm_certificate_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS pgdm_certificate_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pgdm_certificate_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS pgdm_certificate_approval_notes text,
  ADD COLUMN IF NOT EXISTS pgdm_certificate_downloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS pgdm_diploma_ready_notified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pgdm_diploma_ready_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_avr_pgdm_certificate_status
  ON public.alumni_verification_requests (pgdm_certificate_status, request_type, assigned_handler_user_id);

CREATE OR REPLACE FUNCTION public.is_pgdm_diploma_request(_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.alumni_verification_requests avr
    LEFT JOIN public.courses c ON c.id = avr.course_id
    WHERE avr.id = _request_id
      AND avr.request_type = 'diploma'
      AND (
        public.normalize_student_service_course(avr.course) LIKE '%pgdm%'
        OR public.normalize_student_service_course(c.name) LIKE '%pgdm%'
        OR public.normalize_student_service_course(c.code) LIKE '%pgdm%'
        OR public.normalize_student_service_course(avr.course) LIKE '%postgraduatediplomainmanagement%'
        OR public.normalize_student_service_course(c.name) LIKE '%postgraduatediplomainmanagement%'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_pgdm_diploma_request(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_pgdm_certificate_workflow(_request_id uuid, _event text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supa_url text;
  v_service_key text;
BEGIN
  SELECT value INTO v_supa_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_supa_url || '/functions/v1/pgdm-certificate-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'request_id', _request_id,
      'event', _event
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_pgdm_certificate_workflow(%, %) failed: %', _request_id, _event, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_pgdm_certificate_for_approval(
  _request_id uuid,
  _details jsonb,
  _pdf_path text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.alumni_verification_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req
  FROM public.alumni_verification_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF NOT public.is_pgdm_diploma_request(_request_id) THEN
    RAISE EXCEPTION 'Certificate generation is only available for PGDM diploma requests';
  END IF;

  IF NOT (
    v_req.assigned_handler_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Only the assigned handler or Student Services manager can submit this certificate';
  END IF;

  IF NULLIF(_details->>'studentName', '') IS NULL
     OR NULLIF(_details->>'completedYear', '') IS NULL
     OR NULLIF(_details->>'fileNo', '') IS NULL
     OR NULLIF(_details->>'enrollmentNo', '') IS NULL
     OR NULLIF(_details->>'cgpa', '') IS NULL
     OR NULLIF(_details->>'equivalentPercentage', '') IS NULL
     OR NULLIF(_details->>'issueDay', '') IS NULL
     OR NULLIF(_details->>'issueMonthYear', '') IS NULL THEN
    RAISE EXCEPTION 'All certificate fields are required';
  END IF;

  UPDATE public.alumni_verification_requests
  SET pgdm_certificate_details = _details,
      pgdm_certificate_status = 'pending_approval',
      pgdm_certificate_pdf_path = _pdf_path,
      pgdm_certificate_submitted_by = auth.uid(),
      pgdm_certificate_submitted_at = now(),
      pgdm_certificate_approved_by = NULL,
      pgdm_certificate_approved_at = NULL,
      pgdm_certificate_approval_notes = NULL,
      status = CASE WHEN status = 'paid' THEN 'under_review' ELSE status END
  WHERE id = _request_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT ur.user_id,
         'pgdm_certificate_pending',
         'PGDM certificate pending approval',
         COALESCE(v_req.request_number, 'Request') || ' - ' || COALESCE(v_req.alumni_name, 'Student') ||
           ' has been submitted for superadmin approval.',
         '/alumni-verifications'
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'::public.app_role;

  PERFORM public.notify_pgdm_certificate_workflow(_request_id, 'submitted');
  RETURN 'pending_approval';
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_pgdm_certificate_for_approval(uuid, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_pgdm_certificate(
  _request_id uuid,
  _approval_notes text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.alumni_verification_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only superadmin can approve PGDM certificates';
  END IF;

  SELECT * INTO v_req
  FROM public.alumni_verification_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_req.pgdm_certificate_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Certificate is not pending approval';
  END IF;

  UPDATE public.alumni_verification_requests
  SET pgdm_certificate_status = 'approved',
      pgdm_certificate_approved_by = auth.uid(),
      pgdm_certificate_approved_at = now(),
      pgdm_certificate_approval_notes = _approval_notes
  WHERE id = _request_id;

  IF v_req.assigned_handler_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      v_req.assigned_handler_user_id,
      'pgdm_certificate_approved',
      'PGDM certificate approved',
      COALESCE(v_req.request_number, 'Request') || ' - ' || COALESCE(v_req.alumni_name, 'Student') ||
        ' is approved for download and print.',
      '/alumni-verifications'
    );
  END IF;

  PERFORM public.notify_pgdm_certificate_workflow(_request_id, 'approved');
  RETURN 'approved';
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_pgdm_certificate(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_pgdm_certificate_downloaded(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.alumni_verification_requests
  SET pgdm_certificate_downloaded_at = COALESCE(pgdm_certificate_downloaded_at, now())
  WHERE id = _request_id
    AND pgdm_certificate_status IN ('approved', 'ready_notified')
    AND (
      assigned_handler_user_id = auth.uid()
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
      OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pgdm_certificate_downloaded(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_pgdm_diploma_ready_for_collection(_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.alumni_verification_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req
  FROM public.alumni_verification_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_req.pgdm_certificate_status NOT IN ('approved', 'ready_notified') THEN
    RAISE EXCEPTION 'Certificate must be approved before notifying the student';
  END IF;

  IF NOT (
    v_req.assigned_handler_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Only the assigned handler or Student Services manager can notify the student';
  END IF;

  UPDATE public.alumni_verification_requests
  SET pgdm_certificate_status = 'ready_notified',
      pgdm_diploma_ready_notified_by = auth.uid(),
      pgdm_diploma_ready_notified_at = now()
  WHERE id = _request_id;

  PERFORM public.notify_pgdm_certificate_workflow(_request_id, 'ready_for_collection');
  RETURN 'ready_notified';
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_pgdm_diploma_ready_for_collection(uuid) TO authenticated;
