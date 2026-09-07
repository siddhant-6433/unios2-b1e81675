-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260814150419 name=hr_profile_page_access applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.employee_directory_card(_q text DEFAULT NULL)
RETURNS TABLE (
  employee_profile_id uuid,
  employee_number     text,
  display_name        text,
  job_title           text,
  work_location       text,
  mobile_number       text,
  photo_url           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ep.id,
    ep.employee_number,
    COALESCE(NULLIF(btrim(ep.display_name), ''),
             btrim(concat_ws(' ', ep.first_name, ep.last_name))) AS display_name,
    COALESCE(NULLIF(btrim(ep.job_title), ''), dg.name)           AS job_title,
    COALESCE(NULLIF(btrim(ep.work_location), ''), hl.name, c.name) AS work_location,
    COALESCE(NULLIF(btrim(ep.mobile_number), ''), ep.work_number) AS mobile_number,
    ep.photo_url
  FROM public.employee_profiles ep
  LEFT JOIN public.designations dg ON dg.id = ep.designation_id
  LEFT JOIN public.hr_locations hl ON hl.id = ep.hr_location_id
  LEFT JOIN public.campuses     c  ON c.id  = ep.campus_id
  WHERE ep.date_of_exit IS NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text NOT IN (
          'student', 'parent', 'consultant',
          'academic_partner', 'academic_partner_offer_letter', 'publisher'
        )
    )
    AND (
      _q IS NULL OR btrim(_q) = '' OR
      ep.display_name    ILIKE '%' || btrim(_q) || '%' OR
      ep.first_name      ILIKE '%' || btrim(_q) || '%' OR
      ep.last_name       ILIKE '%' || btrim(_q) || '%' OR
      ep.employee_number ILIKE '%' || btrim(_q) || '%' OR
      ep.job_title       ILIKE '%' || btrim(_q) || '%' OR
      ep.work_location   ILIKE '%' || btrim(_q) || '%' OR
      ep.mobile_number   ILIKE '%' || btrim(_q) || '%' OR
      ep.work_number     ILIKE '%' || btrim(_q) || '%'
    )
  ORDER BY 3
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.employee_directory_card(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_directory_card(text) TO authenticated;

COMMENT ON FUNCTION public.employee_directory_card(text) IS
  'Colleague lookup for every staff member. The return signature is the privacy boundary: name, designation, location, employee number, contact, photo. Anything more sensitive has no column here and stays behind employee_profiles RLS.';

DROP POLICY IF EXISTS "HR reads all attendance" ON public.employee_attendance;
CREATE POLICY "HR reads all attendance"
  ON public.employee_attendance
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:view')));

DROP POLICY IF EXISTS "HR edits all attendance" ON public.employee_attendance;
CREATE POLICY "HR edits all attendance"
  ON public.employee_attendance
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')));
