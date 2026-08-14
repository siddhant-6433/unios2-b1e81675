-- Employee profile page: a public directory card for everyone, full attendance for HR.
--
-- Two separate problems, both about who may see what.
--
-- 1. Ordinary staff cannot look up a colleague at all. employee_profiles SELECT is
--    restricted to hr:view holders and the person's own row, which is correct for
--    salary and PAN and much too strict for "what is Umed's extension".
--
--    The fix is NOT to loosen that policy. It is a function whose RETURN SIGNATURE
--    is the allow-list: name, designation, location, employee number, contact. A
--    caller cannot ask it for a salary because it has no column to put one in, so
--    the restriction survives someone calling it straight from the console.
--
-- 2. HR cannot see anyone's attendance. employee_attendance SELECT names three
--    ROLES (super_admin, campus_admin, principal) and never checks the hr:view
--    PERMISSION, so the very people whose job this is are locked out while a
--    campus_admin who never opens the module is not.

-- ---------------------------------------------------------------------------
-- 1. The public card
-- ---------------------------------------------------------------------------

-- Contact is spread across two tables: only 5 of 99 employees have a number on the
-- HR record, another 21 have one on their login, and 95 have a work email. A card
-- that read employee_profiles.mobile_number alone would show a blank contact for
-- three quarters of the company, so it coalesces both and carries the work email —
-- the address already printed on everything they send. Personal email and personal
-- address stay behind RLS.
DROP FUNCTION IF EXISTS public.employee_directory_card(text);
CREATE FUNCTION public.employee_directory_card(_q text DEFAULT NULL)
RETURNS TABLE (
  employee_profile_id uuid,
  employee_number     text,
  display_name        text,
  job_title           text,
  work_location       text,
  mobile_number       text,
  work_email          text,
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
    COALESCE(NULLIF(btrim(ep.mobile_number), ''),
             NULLIF(btrim(ep.work_number), ''),
             NULLIF(btrim(p.phone), ''))                          AS mobile_number,
    ep.work_email,
    ep.photo_url
  FROM public.employee_profiles ep
  LEFT JOIN public.profiles     p  ON p.user_id = ep.user_id
  LEFT JOIN public.designations dg ON dg.id = ep.designation_id
  LEFT JOIN public.hr_locations hl ON hl.id = ep.hr_location_id
  LEFT JOIN public.campuses     c  ON c.id  = ep.campus_id
  WHERE ep.date_of_exit IS NULL
    -- Students and outside parties are not colleagues and get no directory.
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
      ep.work_number     ILIKE '%' || btrim(_q) || '%' OR
      p.phone            ILIKE '%' || btrim(_q) || '%' OR
      ep.work_email      ILIKE '%' || btrim(_q) || '%'
    )
  ORDER BY 3
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.employee_directory_card(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_directory_card(text) TO authenticated;

COMMENT ON FUNCTION public.employee_directory_card(text) IS
  'Colleague lookup for every staff member. The return signature is the privacy '
  'boundary: name, designation, location, employee number, contact, photo. Anything '
  'more sensitive has no column here and stays behind employee_profiles RLS.';

-- ---------------------------------------------------------------------------
-- 2. Let HR read attendance
-- ---------------------------------------------------------------------------

-- Additive: the existing role-based policy is left exactly as it is, so nobody
-- loses access. This only adds the permission the module is actually gated on.
DROP POLICY IF EXISTS "HR reads all attendance" ON public.employee_attendance;
CREATE POLICY "HR reads all attendance"
  ON public.employee_attendance
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:view')));

-- Correcting attendance is a stronger act than reading it, and there is already a
-- permission for exactly that.
DROP POLICY IF EXISTS "HR edits all attendance" ON public.employee_attendance;
CREATE POLICY "HR edits all attendance"
  ON public.employee_attendance
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')));
