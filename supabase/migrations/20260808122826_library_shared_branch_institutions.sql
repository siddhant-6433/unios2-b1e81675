-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260808122826 name=library_shared_branch_institutions applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.library_branch_institutions (
  branch_id uuid NOT NULL REFERENCES public.library_branches(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, institution_id)
);

ALTER TABLE public.library_branch_institutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users view branch institutions" ON public.library_branch_institutions;
CREATE POLICY "Authenticated users view branch institutions" ON public.library_branch_institutions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Library managers maintain branch institutions" ON public.library_branch_institutions;
CREATE POLICY "Library managers maintain branch institutions" ON public.library_branch_institutions
  FOR ALL TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'))
  WITH CHECK (public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'));

CREATE OR REPLACE FUNCTION public.library_branch_institution_ids(_branch_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT institution_id FROM public.library_branches WHERE id = _branch_id
  UNION
  SELECT institution_id FROM public.library_branch_institutions WHERE branch_id = _branch_id;
$$;
GRANT EXECUTE ON FUNCTION public.library_branch_institution_ids(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.library_course_serves_branch(_course_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.courses c
    JOIN public.departments d ON d.id = c.department_id
    WHERE c.id = _course_id
      AND d.institution_id IN (SELECT public.library_branch_institution_ids(_branch_id))
  )
$$;
GRANT EXECUTE ON FUNCTION public.library_course_serves_branch(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.library_student_can_borrow_from_branch(_student_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.library_branches b ON b.id = _branch_id
    JOIN public.library_branch_courses lbc
      ON lbc.branch_id = b.id
     AND lbc.course_id = s.course_id
     AND lbc.active
    JOIN public.courses c ON c.id = s.course_id
    JOIN public.departments d ON d.id = c.department_id
    WHERE s.id = _student_id
      AND s.status = 'active'
      AND s.admission_no IS NOT NULL
      AND s.campus_id = b.campus_id
      AND d.institution_id IN (SELECT public.library_branch_institution_ids(b.id))
  )
$$;

DROP POLICY IF EXISTS "Library managers maintain branch courses" ON public.library_branch_courses;
CREATE POLICY "Library managers maintain branch courses" ON public.library_branch_courses
  FOR ALL TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'))
  WITH CHECK (
    public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings')
    AND public.library_course_serves_branch(course_id, branch_id)
  );

INSERT INTO public.library_branches (campus_id, institution_id, name, code)
SELECT 'c0000001-0000-0000-0000-000000000001'::uuid,
       '9be6295d-7755-4bde-bda9-a466f08ea594'::uuid,
       'Management Library', 'LIB-MGMT'
WHERE NOT EXISTS (
  SELECT 1 FROM public.library_branches
  WHERE campus_id = 'c0000001-0000-0000-0000-000000000001'::uuid
    AND institution_id = '9be6295d-7755-4bde-bda9-a466f08ea594'::uuid
    AND name = 'Management Library'
);

INSERT INTO public.library_branch_institutions (branch_id, institution_id)
SELECT b.id, 'b0000001-0000-0000-0000-000000000005'::uuid
FROM public.library_branches b
WHERE b.name = 'Management Library'
  AND b.campus_id = 'c0000001-0000-0000-0000-000000000001'::uuid
  AND b.institution_id = '9be6295d-7755-4bde-bda9-a466f08ea594'::uuid
ON CONFLICT (branch_id, institution_id) DO NOTHING;

INSERT INTO public.library_branch_courses (branch_id, course_id)
SELECT b.id, c.id
FROM public.library_branches b
JOIN public.departments d
  ON d.institution_id IN ('9be6295d-7755-4bde-bda9-a466f08ea594'::uuid, 'b0000001-0000-0000-0000-000000000005'::uuid)
JOIN public.courses c ON c.department_id = d.id AND c.is_active
WHERE b.name = 'Management Library'
  AND b.campus_id = 'c0000001-0000-0000-0000-000000000001'::uuid
  AND b.institution_id = '9be6295d-7755-4bde-bda9-a466f08ea594'::uuid
ON CONFLICT (branch_id, course_id) DO NOTHING;
