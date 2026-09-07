-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712080656 name=transfer_certificate_workflow_fix applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP POLICY IF EXISTS "Staff can view TC requests" ON public.student_tc_requests;
CREATE POLICY "Staff can view TC requests"
  ON public.student_tc_requests FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'office_assistant'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
  );

GRANT SELECT ON public.student_tc_requests TO authenticated;
GRANT ALL    ON public.student_tc_requests TO service_role;
GRANT ALL    ON public.tc_number_counters  TO service_role;

CREATE OR REPLACE FUNCTION public.tc_academic_year(_d date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM _d) >= 4
      THEN EXTRACT(YEAR FROM _d)::int || '-' || lpad(((EXTRACT(YEAR FROM _d)::int + 1) % 100)::text, 2, '0')
    ELSE (EXTRACT(YEAR FROM _d)::int - 1) || '-' || lpad((EXTRACT(YEAR FROM _d)::int % 100)::text, 2, '0')
  END;
$$;

CREATE OR REPLACE FUNCTION public.submit_tc_request(_student_id uuid, _details jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_fee     jsonb;
  v_due     numeric;
  v_id      uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'office_assistant'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized to request a transfer certificate';
  END IF;

  SELECT * INTO v_student FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  IF v_student.lead_id IS NULL THEN
    RAISE EXCEPTION 'No linked fee record for this student; fee clearance cannot be verified';
  END IF;

  v_fee := public.lead_fee_status(v_student.lead_id);
  v_due := COALESCE((v_fee->>'full_course_amount_due')::numeric, 0);
  IF v_due <> 0 THEN
    RAISE EXCEPTION 'Cannot issue TC: outstanding dues of %', v_due;
  END IF;

  INSERT INTO public.student_tc_requests (
    student_id, campus_id, status, tc_details, fee_snapshot, reason_for_leaving, requested_by
  ) VALUES (
    _student_id, v_student.campus_id, 'pending_approval', COALESCE(_details, '{}'::jsonb), v_fee,
    NULLIF(_details->>'reasonForLeaving', ''), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT ur.user_id,
         'approval_pending',
         'Transfer certificate pending approval',
         COALESCE(v_student.name, 'Student') || ' (' || COALESCE(v_student.admission_no, '—') ||
           ') has a transfer certificate awaiting approval.',
         '/students/' || _student_id
  FROM public.user_roles ur
  WHERE ur.role IN ('super_admin'::public.app_role, 'principal'::public.app_role);

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_tc_request(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_tc_request(_request_id uuid, _notes text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req     public.student_tc_requests%ROWTYPE;
  v_ay      text;
  v_prefix  text;
  v_seq     int;
  v_number  text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Only principal or super admin can approve a transfer certificate';
  END IF;

  SELECT * INTO v_req FROM public.student_tc_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Request is not pending approval';
  END IF;

  v_ay := public.tc_academic_year(current_date);
  v_prefix := COALESCE((public.student_branding(v_req.student_id)).tc_serial_prefix, 'TC');

  INSERT INTO public.tc_number_counters (campus_id, academic_year, last_seq)
  VALUES (v_req.campus_id, v_ay, 1)
  ON CONFLICT (campus_id, academic_year)
    DO UPDATE SET last_seq = public.tc_number_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_number := v_prefix || '/' || v_ay || '/' || lpad(v_seq::text, 3, '0');

  UPDATE public.student_tc_requests
  SET status = 'approved', tc_number = v_number, issue_date = current_date,
      approved_by = auth.uid(), approved_at = now(), decision_notes = _notes
  WHERE id = _request_id;

  IF v_req.requested_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_req.requested_by, 'approval_decided',
            'Transfer certificate approved',
            'TC ' || v_number || ' approved and ready to generate.',
            '/students/' || v_req.student_id);
  END IF;

  RETURN v_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_tc_request(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_tc_request(_request_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.student_tc_requests%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Only principal or super admin can reject a transfer certificate';
  END IF;

  SELECT * INTO v_req FROM public.student_tc_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Request is not pending approval';
  END IF;

  UPDATE public.student_tc_requests
  SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), decision_notes = _notes
  WHERE id = _request_id;

  IF v_req.requested_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_req.requested_by, 'approval_decided',
            'Transfer certificate rejected',
            'A transfer certificate request was rejected' || COALESCE(': ' || _notes, '') || '.',
            '/students/' || v_req.student_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_tc_request(uuid, text) TO authenticated;
