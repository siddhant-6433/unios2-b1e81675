-- Backing for the HR self-service page (/my-hr, permission hr:self).
--
-- Non-teaching staff (housekeeping, security, support) have no reason to see
-- students, leads or finance — their whole login is: my attendance, my leave,
-- who's who, and when are the holidays.
--
-- employee_attendance, employee_leave_requests and employee_leave_balances are
-- already self-scoped by RLS (auth.uid() = user_id), so they need no change.
-- The two gaps are holidays (no table at all) and the directory.

-- ---------------------------------------------------------------------------
-- 1. Holidays
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.holidays (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  holiday_date   date NOT NULL,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  campus_id      uuid REFERENCES public.campuses(id) ON DELETE CASCADE,
  -- 'public' = office closed, 'restricted' = optional, 'academic' = students only
  kind           text NOT NULL DEFAULT 'public'
                 CHECK (kind IN ('public', 'restricted', 'academic')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES auth.users(id)
);

-- NULL institution/campus = applies everywhere; NULLS NOT DISTINCT so the same
-- org-wide holiday can't be entered twice for the same date.
CREATE UNIQUE INDEX IF NOT EXISTS holidays_unique
  ON public.holidays (holiday_date, institution_id, campus_id, name)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS holidays_date_idx ON public.holidays (holiday_date);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;

-- Everyone on staff can read the calendar; only HR can change it.
DROP POLICY IF EXISTS holidays_read ON public.holidays;
CREATE POLICY holidays_read ON public.holidays
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS holidays_hr_write ON public.holidays;
CREATE POLICY holidays_hr_write ON public.holidays
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:view' = ANY (public.get_user_permissions(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:view' = ANY (public.get_user_permissions(auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 2. Staff directory
-- ---------------------------------------------------------------------------
-- `profiles` SELECT is limited to a fixed role list that (correctly) excludes
-- non_teaching, so a directory query returns only the caller's own row. Rather
-- than widen that policy — which would hand every phone number and email in the
-- org to housekeeping — expose a narrow definer view of the columns a directory
-- actually needs, gated on hr:self.

CREATE OR REPLACE FUNCTION public.hr_staff_directory()
RETURNS TABLE (
  user_id       uuid,
  display_name  text,
  designation   text,
  department    text,
  campus        text,
  work_email    text,
  photo_url     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      'academic_partner', 'academic_partner_offer_letter', 'publisher'
    )
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR 'hr:self' = ANY (public.get_user_permissions(auth.uid()))
      OR 'hr:view' = ANY (public.get_user_permissions(auth.uid()))
    )
  ORDER BY COALESCE(ep.display_name, p.display_name);
$$;

REVOKE ALL ON FUNCTION public.hr_staff_directory() FROM public;
GRANT EXECUTE ON FUNCTION public.hr_staff_directory() TO authenticated;
