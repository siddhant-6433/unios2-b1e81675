-- ====================================================================
-- Super-admin: change / migrate a student's placement (course · batch ·
-- session, and section for schools) for transfers or corrections.
--   * super_admin only, reason required.
--   * Validates batch ↔ course/session agreement and that an active
--     fee_structure exists for the target course+session BEFORE mutating,
--     so we never strand a student in a placement the fee provisioner
--     would then reject.
--   * Writes one student_audit_log row per changed field (event_type
--     'placement_change') with old/new labels in metadata.
--   * Resets fee_structure_version so provision-student-fees resolves the
--     target's current active version afresh. Fees are re-provisioned by
--     the client invoking the provision-student-fees edge fn afterwards.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.admin_change_student_placement(
  _student_id uuid,
  _course_id  uuid,
  _batch_id   uuid,   -- NULL for the school flow (no batch)
  _session_id uuid,
  _section    text,   -- NULL for the college flow (keeps existing)
  _reason     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old         public.students%ROWTYPE;
  v_inst_type   text;
  v_new_course  text;
  v_new_batch   text;
  v_new_session text;
  v_old_course  text;
  v_old_batch   text;
  v_old_session text;
BEGIN
  -- Gate: super_admin only (no is_super_admin() helper — always has_role).
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can change a student''s placement';
  END IF;
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to change placement';
  END IF;

  SELECT * INTO v_old FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  -- Target course must exist; capture institution type (school vs college).
  SELECT i.type INTO v_inst_type
  FROM public.courses c
  JOIN public.departments d  ON d.id = c.department_id
  JOIN public.institutions i ON i.id = d.institution_id
  WHERE c.id = _course_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target course not found'; END IF;

  -- Target session must exist.
  PERFORM 1 FROM public.admission_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target session not found'; END IF;

  -- Batch is optional (school flow passes NULL). If given, it must belong to
  -- the chosen course, and either be session-less (legacy) or match the session.
  IF _batch_id IS NOT NULL THEN
    PERFORM 1 FROM public.batches b
    WHERE b.id = _batch_id
      AND b.course_id = _course_id
      AND (b.session_id IS NULL OR b.session_id = _session_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected batch does not belong to the chosen course/session';
    END IF;
  END IF;

  -- Pre-validate an active fee structure exists for the target course+session
  -- BEFORE mutating, so the change never lands the student somewhere the fee
  -- provisioner will reject.
  PERFORM 1 FROM public.fee_structures
  WHERE course_id = _course_id AND session_id = _session_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No active fee structure for the target course/session — create one before transferring';
  END IF;

  -- Human labels for the audit metadata (best-effort).
  SELECT name INTO v_new_course  FROM public.courses            WHERE id = _course_id;
  SELECT name INTO v_new_session FROM public.admission_sessions WHERE id = _session_id;
  SELECT name INTO v_new_batch   FROM public.batches            WHERE id = _batch_id;
  SELECT name INTO v_old_course  FROM public.courses            WHERE id = v_old.course_id;
  SELECT name INTO v_old_session FROM public.admission_sessions WHERE id = v_old.session_id;
  SELECT name INTO v_old_batch   FROM public.batches            WHERE id = v_old.batch_id;

  UPDATE public.students
  SET course_id  = _course_id,
      batch_id   = _batch_id,
      session_id = _session_id,
      section    = COALESCE(_section, section),
      -- Old version pointer is meaningless in the new course/session
      -- (fee_structures is UNIQUE(course_id, session_id, version)); null it so
      -- provisioning resolves the target's current active version.
      fee_structure_version = NULL
  WHERE id = _student_id;

  -- One audit row per field that actually changed.
  IF v_old.course_id IS DISTINCT FROM _course_id THEN
    INSERT INTO public.student_audit_log
      (student_id, actor_user_id, event_type, field_name, old_value, new_value, reason, metadata)
    VALUES (_student_id, auth.uid(), 'placement_change', 'course_id',
      v_old.course_id::text, _course_id::text, _reason,
      jsonb_build_object('old_label', v_old_course, 'new_label', v_new_course,
                         'institution_type', v_inst_type));
  END IF;
  IF v_old.batch_id IS DISTINCT FROM _batch_id THEN
    INSERT INTO public.student_audit_log
      (student_id, actor_user_id, event_type, field_name, old_value, new_value, reason, metadata)
    VALUES (_student_id, auth.uid(), 'placement_change', 'batch_id',
      v_old.batch_id::text, _batch_id::text, _reason,
      jsonb_build_object('old_label', v_old_batch, 'new_label', v_new_batch));
  END IF;
  IF v_old.session_id IS DISTINCT FROM _session_id THEN
    INSERT INTO public.student_audit_log
      (student_id, actor_user_id, event_type, field_name, old_value, new_value, reason, metadata)
    VALUES (_student_id, auth.uid(), 'placement_change', 'session_id',
      v_old.session_id::text, _session_id::text, _reason,
      jsonb_build_object('old_label', v_old_session, 'new_label', v_new_session));
  END IF;
  IF _section IS NOT NULL AND v_old.section IS DISTINCT FROM _section THEN
    INSERT INTO public.student_audit_log
      (student_id, actor_user_id, event_type, field_name, old_value, new_value, reason, metadata)
    VALUES (_student_id, auth.uid(), 'placement_change', 'section',
      v_old.section, _section, _reason,
      jsonb_build_object('institution_type', v_inst_type));
  END IF;

  RETURN _student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.admin_change_student_placement(uuid, uuid, uuid, uuid, text, text) TO authenticated;
