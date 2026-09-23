-- report student archive status
CREATE OR REPLACE FUNCTION public.report_student_archive_status(_student_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_permission(auth.uid(), 'reports:view')
    OR public.has_permission(auth.uid(), 'finance:view')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'statuses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'student_id', s.id,
        'student_status', CASE WHEN s.archived_at IS NULL THEN 'active' ELSE 'archived' END
      ) ORDER BY s.id)
      FROM public.students s
      WHERE _student_ids IS NOT NULL
        AND s.id = ANY(_student_ids)
        AND public.user_can_access_record_campus(auth.uid(), s.campus_id)
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.report_student_archive_status(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_student_archive_status(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
