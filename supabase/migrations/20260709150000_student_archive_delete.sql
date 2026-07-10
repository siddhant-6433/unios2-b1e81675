-- ====================================================================
-- Student removal: archive (reversible) + delete (super_admin, tombstone).
--   * Archive  — office_assistant / principal / super_admin, reason required.
--   * Unarchive — same roles.
--   * Delete   — super_admin only, reason required (soft-delete tombstone so
--                fee/attendance/audit history is preserved).
--   A transfer certificate can only be issued for an ARCHIVED student
--   (see the updated submit_tc_request below), with dues fully cleared.
-- ====================================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS deleted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason  text;

CREATE INDEX IF NOT EXISTS idx_students_deleted_at ON public.students (deleted_at);

-- ── Archive ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_student(_student_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'office_assistant'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized to archive students';
  END IF;
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to archive a student';
  END IF;

  SELECT status::text INTO v_old FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  UPDATE public.students
  SET archived_at = now(), archived_by = auth.uid(), archive_reason = _reason,
      status = 'inactive'
  WHERE id = _student_id;

  INSERT INTO public.student_audit_log (student_id, actor_user_id, event_type, field_name, old_value, new_value, reason)
  VALUES (_student_id, auth.uid(), 'archived', 'status', v_old, 'inactive', _reason);
END;
$$;
GRANT EXECUTE ON FUNCTION public.archive_student(uuid, text) TO authenticated;

-- ── Unarchive ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unarchive_student(_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'office_assistant'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized to unarchive students';
  END IF;

  UPDATE public.students
  SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, status = 'active'
  WHERE id = _student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  INSERT INTO public.student_audit_log (student_id, actor_user_id, event_type, field_name, new_value)
  VALUES (_student_id, auth.uid(), 'unarchived', 'status', 'active');
END;
$$;
GRANT EXECUTE ON FUNCTION public.unarchive_student(uuid) TO authenticated;

-- ── Delete (super_admin only, soft-delete tombstone) ─────────────────
CREATE OR REPLACE FUNCTION public.delete_student(_student_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can delete a student';
  END IF;
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to delete a student';
  END IF;

  UPDATE public.students
  SET deleted_at = now(), deleted_by = auth.uid(), delete_reason = _reason
  WHERE id = _student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  INSERT INTO public.student_audit_log (student_id, actor_user_id, event_type, reason)
  VALUES (_student_id, auth.uid(), 'deleted', _reason);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_student(uuid, text) TO authenticated;

-- ── TC gate: only for archived students (+ existing hard fee-clearance) ──
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  -- A TC is only issued for a student who has been archived (left the school).
  IF v_student.archived_at IS NULL THEN
    RAISE EXCEPTION 'Student must be archived before a transfer certificate can be issued';
  END IF;

  -- Hard fee gate: requires a linked lead and zero course dues.
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
