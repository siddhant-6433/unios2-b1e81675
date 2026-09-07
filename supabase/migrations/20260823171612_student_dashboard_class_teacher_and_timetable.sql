-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260823171612 name=student_dashboard_class_teacher_and_timetable applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.student_class_teacher_for_viewer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_st  public.students%ROWTYPE;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_st FROM public.students WHERE user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'name',        p.display_name,
    'photo_url',   COALESCE(ep.photo_url, p.avatar_url),
    'phone',       COALESCE(ep.mobile_number, p.phone),
    'designation', ep.job_title
  )
  INTO v_out
  FROM public.class_teachers ct
  JOIN public.profiles p ON p.user_id = ct.teacher_user_id
  LEFT JOIN public.employee_profiles ep ON ep.user_id = ct.teacher_user_id
  WHERE ct.active
    AND (
      (ct.batch_id IS NOT NULL AND ct.batch_id = v_st.batch_id)
      OR (ct.course_id IS NOT NULL AND ct.course_id = v_st.course_id)
    )
    AND (ct.section IS NULL OR ct.section = v_st.section)
    AND (ct.session_id IS NULL OR ct.session_id = v_st.session_id)
  ORDER BY (ct.batch_id IS NOT NULL) DESC, ct.created_at DESC
  LIMIT 1;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.student_class_teacher_for_viewer() TO authenticated;

CREATE OR REPLACE FUNCTION public.student_timetable_for_viewer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_batch_id uuid;
  v_periods  jsonb;
  v_entries  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('periods', '[]'::jsonb, 'entries', '[]'::jsonb);
  END IF;

  SELECT batch_id INTO v_batch_id FROM public.students WHERE user_id = v_uid LIMIT 1;
  IF v_batch_id IS NULL THEN
    RETURN jsonb_build_object('periods', '[]'::jsonb, 'entries', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', te.id,
             'period_id', te.period_id,
             'day_of_week', te.day_of_week,
             'subject', s.name,
             'faculty', p.display_name,
             'room', te.room
           )
         ), '[]'::jsonb)
  INTO v_entries
  FROM public.timetable_entries te
  LEFT JOIN public.subjects s ON s.id = te.subject_id
  LEFT JOIN public.profiles p ON p.user_id = te.faculty_user_id
  WHERE te.batch_id = v_batch_id;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', cp.id,
             'period_no', cp.period_no,
             'label', cp.label,
             'start_time', cp.start_time,
             'end_time', cp.end_time
           ) ORDER BY cp.period_no
         ), '[]'::jsonb)
  INTO v_periods
  FROM public.class_periods cp
  WHERE cp.active
    AND cp.id IN (SELECT period_id FROM public.timetable_entries WHERE batch_id = v_batch_id);

  RETURN jsonb_build_object('periods', v_periods, 'entries', v_entries);
END;
$$;

GRANT EXECUTE ON FUNCTION public.student_timetable_for_viewer() TO authenticated;
