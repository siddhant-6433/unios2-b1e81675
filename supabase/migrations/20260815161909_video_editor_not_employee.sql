-- Video editors are external VENDORS, not employees. Two leaks made them look
-- like staff:
--   1. The `hr:self` permission was granted to the video_editor role by a blanket
--      "everyone on staff" CROSS JOIN (20260813095518), which surfaced HR → My HR
--      in their sidebar and let them reach /my-hr. Revoke it.
--   2. hr_staff_directory() (backs My HR / the staff directory) excludes other
--      vendor roles (consultant, publisher, academic_partner…) but not
--      video_editor. Add it to the exclusion list.

-- 1. Revoke the leaked HR self-service permission from the vendor role.
DELETE FROM public.role_permissions
 WHERE role = 'video_editor'
   AND permission_id = (SELECT id FROM public.permissions WHERE module = 'hr' AND action = 'self');

-- 2. Keep video editors out of the staff directory (add 'video_editor' to the
--    NOT IN list; everything else unchanged).
CREATE OR REPLACE FUNCTION public.hr_staff_directory()
 RETURNS TABLE(user_id uuid, display_name text, designation text, department text, campus text, work_email text, photo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id,
    COALESCE(ep.display_name, p.display_name)          AS display_name,
    COALESCE(ep.job_title, dg.name)                    AS designation,
    COALESCE(d.name, p.department)                     AS department,
    COALESCE(c.name, p.campus)                         AS campus,
    ep.work_email,
    ep.photo_url
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id
  LEFT JOIN public.employee_profiles ep ON ep.user_id = p.user_id
  LEFT JOIN public.departments  d  ON d.id  = ep.department_id
  LEFT JOIN public.designations dg ON dg.id = ep.designation_id
  LEFT JOIN public.campuses     c  ON c.id  = ep.campus_id
  WHERE p.deleted_at IS NULL
    AND p.archived_at IS NULL
    AND COALESCE(p.login_disabled, false) = false
    AND ur.role::text NOT IN (
      'student', 'parent', 'consultant',
      'academic_partner', 'academic_partner_offer_letter', 'publisher',
      'video_editor'
    )
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR 'hr:self' = ANY (public.get_user_permissions(auth.uid()))
      OR 'hr:view' = ANY (public.get_user_permissions(auth.uid()))
    )
  ORDER BY COALESCE(ep.display_name, p.display_name);
$function$;
