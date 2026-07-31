-- Append-only audit trail for PGDM certificate actions.
--
-- Anyone with Student Services access can work a request regardless of handler
-- assignment (fast resolution), so who actually submitted / regenerated /
-- approved must be recorded durably. The single-column stamps on
-- alumni_verification_requests were last-writer-wins and, worse, "Regenerate"
-- NULLed the submit stamps — erasing the fact that a submission ever happened.
-- This log is written only from SECURITY DEFINER RPCs (never client-side), so
-- it is genuinely append-only and immune to that wipe.

CREATE TABLE IF NOT EXISTS public.pgdm_certificate_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.alumni_verification_requests(id) ON DELETE CASCADE,
  action text NOT NULL, -- submitted | approved | regenerated | downloaded | ready_notified
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pgdm_cert_audit_request
  ON public.pgdm_certificate_audit (request_id, created_at DESC);

ALTER TABLE public.pgdm_certificate_audit ENABLE ROW LEVEL SECURITY;

-- Read mirrors who can work the certificate: assigned handler, Student Services
-- manager, or super_admin. No INSERT/UPDATE/DELETE policy exists — the log is
-- written exclusively by the DEFINER RPCs below, keeping it append-only.
DROP POLICY IF EXISTS "pgdm_cert_audit_read" ON public.pgdm_certificate_audit;
CREATE POLICY "pgdm_cert_audit_read" ON public.pgdm_certificate_audit
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.alumni_verification_requests avr
      WHERE avr.id = pgdm_certificate_audit.request_id
        AND avr.assigned_handler_user_id = auth.uid()
    )
  );

GRANT SELECT ON public.pgdm_certificate_audit TO authenticated;

-- Helper: stamp one audit row, resolving a display name for the actor once.
CREATE OR REPLACE FUNCTION public.log_pgdm_certificate_action(
  _request_id uuid,
  _action text,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT COALESCE(NULLIF(display_name, ''), email)
    INTO v_name
  FROM public.profiles
  WHERE user_id = auth.uid();

  INSERT INTO public.pgdm_certificate_audit (request_id, action, actor_id, actor_name, details)
  VALUES (_request_id, _action, auth.uid(), v_name, COALESCE(_details, '{}'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_pgdm_certificate_action(uuid, text, jsonb) TO authenticated, service_role;

-- Regenerate is now an audited RPC (was a raw client-side UPDATE that silently
-- reverted a pending/approved certificate to draft with no trace — the root
-- cause of a submitted certificate vanishing from the approval queue).
CREATE OR REPLACE FUNCTION public.regenerate_pgdm_certificate(_request_id uuid)
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

  IF NOT (
    v_req.assigned_handler_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Only the assigned handler or Student Services manager can regenerate this certificate';
  END IF;

  UPDATE public.alumni_verification_requests
  SET pgdm_certificate_status = 'draft',
      pgdm_certificate_submitted_by = NULL,
      pgdm_certificate_submitted_at = NULL,
      pgdm_certificate_approved_by = NULL,
      pgdm_certificate_approved_at = NULL,
      pgdm_certificate_approval_notes = NULL,
      pgdm_certificate_downloaded_at = NULL
  WHERE id = _request_id;

  PERFORM public.log_pgdm_certificate_action(
    _request_id, 'regenerated',
    jsonb_build_object('from_status', v_req.pgdm_certificate_status)
  );
  RETURN 'draft';
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_pgdm_certificate(uuid) TO authenticated;

-- Add audit logging to the existing workflow RPCs (CREATE OR REPLACE, bodies
-- unchanged except for the log call; submit now links superadmins to /inbox).

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
         '/inbox'
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'::public.app_role;

  PERFORM public.log_pgdm_certificate_action(_request_id, 'submitted', '{}'::jsonb);
  PERFORM public.notify_pgdm_certificate_workflow(_request_id, 'submitted');
  RETURN 'pending_approval';
END;
$$;

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

  PERFORM public.log_pgdm_certificate_action(
    _request_id, 'approved',
    jsonb_build_object('notes', _approval_notes)
  );
  PERFORM public.notify_pgdm_certificate_workflow(_request_id, 'approved');
  RETURN 'approved';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pgdm_certificate_downloaded(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first boolean;
BEGIN
  UPDATE public.alumni_verification_requests
  SET pgdm_certificate_downloaded_at = COALESCE(pgdm_certificate_downloaded_at, now())
  WHERE id = _request_id
    AND pgdm_certificate_status IN ('approved', 'ready_notified')
    AND (
      assigned_handler_user_id = auth.uid()
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
      OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
    )
  RETURNING (pgdm_certificate_downloaded_at = now()) INTO v_first;

  -- Log only the first download to keep the trail readable.
  IF v_first THEN
    PERFORM public.log_pgdm_certificate_action(_request_id, 'downloaded', '{}'::jsonb);
  END IF;
END;
$$;

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

  PERFORM public.log_pgdm_certificate_action(_request_id, 'ready_notified', '{}'::jsonb);
  PERFORM public.notify_pgdm_certificate_workflow(_request_id, 'ready_for_collection');
  RETURN 'ready_notified';
END;
$$;
