-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260902100443 name=change_student_placement applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.admin_change_student_placement(
  _student_id uuid,
  _course_id  uuid,
  _batch_id   uuid,
  _session_id uuid,
  _section    text,
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
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can change a student''s placement';
  END IF;
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to change placement';
  END IF;

  SELECT * INTO v_old FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  SELECT i.type INTO v_inst_type
  FROM public.courses c
  JOIN public.departments d  ON d.id = c.department_id
  JOIN public.institutions i ON i.id = d.institution_id
  WHERE c.id = _course_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target course not found'; END IF;

  PERFORM 1 FROM public.admission_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target session not found'; END IF;

  IF _batch_id IS NOT NULL THEN
    PERFORM 1 FROM public.batches b
    WHERE b.id = _batch_id
      AND b.course_id = _course_id
      AND (b.session_id IS NULL OR b.session_id = _session_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected batch does not belong to the chosen course/session';
    END IF;
  END IF;

  PERFORM 1 FROM public.fee_structures
  WHERE course_id = _course_id AND session_id = _session_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No active fee structure for the target course/session — create one before transferring';
  END IF;

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
      fee_structure_version = NULL
  WHERE id = _student_id;

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
