-- Counsellors should only see/update students they admitted or students linked
-- to leads currently assigned to them. Broader staff roles keep their existing
-- student visibility.

CREATE OR REPLACE FUNCTION public.user_assigned_campus_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[])
  FROM public.profiles p
  JOIN public.campuses c
    ON lower(c.name) = lower(p.campus)
    OR lower(c.code) = lower(p.campus)
  WHERE p.user_id = _user_id
    AND p.campus IS NOT NULL
    AND btrim(p.campus) <> '';
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_assigned_campus(_user_id uuid, _campus_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _campus_id IS NOT NULL
     AND _campus_id = ANY(public.user_assigned_campus_ids(_user_id));
$$;

GRANT EXECUTE ON FUNCTION public.user_assigned_campus_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_assigned_campus(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Staff can view students" ON public.students;
DROP POLICY IF EXISTS "Admins can manage students" ON public.students;
DROP POLICY IF EXISTS "Staff can manage students" ON public.students;
DROP POLICY IF EXISTS "Staff can insert students" ON public.students;
DROP POLICY IF EXISTS "Staff can update students" ON public.students;

CREATE POLICY "Staff can view students" ON public.students
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    auth.uid() = user_id OR
    (
      public.has_role(auth.uid(), 'office_assistant')
      AND public.user_can_access_assigned_campus(auth.uid(), students.campus_id)
    ) OR
    (
      public.has_role(auth.uid(), 'counsellor')
      AND (
        students.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          WHERE l.id = students.lead_id
            AND l.counsellor_id = (
              SELECT p.id
              FROM public.profiles p
              WHERE p.user_id = auth.uid()
              LIMIT 1
            )
        )
      )
    )
  );

CREATE POLICY "Staff can insert students" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin')
  );

CREATE POLICY "Staff can update students" ON public.students
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    (
      public.has_role(auth.uid(), 'counsellor')
      AND (
        students.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          WHERE l.id = students.lead_id
            AND l.counsellor_id = (
              SELECT p.id
              FROM public.profiles p
              WHERE p.user_id = auth.uid()
              LIMIT 1
            )
        )
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    (
      public.has_role(auth.uid(), 'counsellor')
      AND (
        students.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          WHERE l.id = students.lead_id
            AND l.counsellor_id = (
              SELECT p.id
              FROM public.profiles p
              WHERE p.user_id = auth.uid()
              LIMIT 1
            )
        )
      )
    )
  );
