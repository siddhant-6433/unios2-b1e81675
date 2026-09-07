-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260813043930 name=teacher_role_scoping applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.class_teachers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  section         text,
  session_id      uuid REFERENCES public.admission_sessions(id),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS class_teachers_unique
  ON public.class_teachers (teacher_user_id, batch_id, section, session_id)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS class_teachers_batch_idx
  ON public.class_teachers (batch_id) WHERE active;
CREATE INDEX IF NOT EXISTS class_teachers_teacher_idx
  ON public.class_teachers (teacher_user_id) WHERE active;

ALTER TABLE public.class_teachers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_teachers TO authenticated;
GRANT ALL ON public.class_teachers TO service_role;

DROP POLICY IF EXISTS ct_self_select ON public.class_teachers;
CREATE POLICY ct_self_select ON public.class_teachers
  FOR SELECT TO authenticated
  USING (teacher_user_id = auth.uid());

DROP POLICY IF EXISTS ct_inst_admin_all ON public.class_teachers;
CREATE POLICY ct_inst_admin_all ON public.class_teachers
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.batches b
      WHERE b.id = class_teachers.batch_id
        AND public.has_course_institution_access(auth.uid(), b.course_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.batches b
      WHERE b.id = class_teachers.batch_id
        AND public.has_course_institution_access(auth.uid(), b.course_id)
    )
  );

CREATE OR REPLACE FUNCTION public.teaches_student(_user_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students st
    JOIN public.class_teachers ct
      ON ct.batch_id = st.batch_id
     AND ct.active
     AND (ct.section IS NULL OR ct.section = st.section)
     AND (ct.session_id IS NULL OR ct.session_id = st.session_id)
    WHERE st.id = _student_id
      AND ct.teacher_user_id = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.students st
    JOIN public.subject_allocations sa
      ON sa.batch_id = st.batch_id
     AND sa.active
     AND (sa.section IS NULL OR sa.section = st.section)
     AND (sa.session_id IS NULL OR sa.session_id = st.session_id)
    WHERE st.id = _student_id
      AND sa.faculty_user_id = _user_id
  );
$$;

COMMENT ON FUNCTION public.teaches_student(uuid, uuid) IS
  'True when the user is the class teacher of, or holds a subject allocation for, the student''s batch/section.';

DROP POLICY IF EXISTS "Staff can view students" ON public.students;
CREATE POLICY "Staff can view students" ON public.students
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_role(auth.uid(), 'admission_head')
    OR public.has_role(auth.uid(), 'data_entry')
    OR public.has_role(auth.uid(), 'office_admin')
    OR (auth.uid() = user_id)
    OR (
      public.has_role(auth.uid(), 'office_assistant')
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

DROP POLICY IF EXISTS "Institution staff can view students" ON public.students;
CREATE POLICY "Institution staff can view students" ON public.students
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')
        OR public.has_role(auth.uid(), 'principal')
        OR public.has_role(auth.uid(), 'accountant')
        OR public.has_role(auth.uid(), 'data_entry')
        OR public.has_role(auth.uid(), 'office_assistant')
        OR public.has_role(auth.uid(), 'office_admin')
        OR public.has_role(auth.uid(), 'hostel_warden')
        OR public.has_role(auth.uid(), 'ib_coordinator')
      )
      AND public.has_student_institution_access(auth.uid(), id)
    )
  );

DROP POLICY IF EXISTS "Teachers view own class students" ON public.students;
CREATE POLICY "Teachers view own class students" ON public.students
  FOR SELECT TO authenticated
  USING (
    (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'faculty'))
    AND public.teaches_student(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Institution staff can view attendance" ON public.daily_attendance;
CREATE POLICY "Institution staff can view attendance" ON public.daily_attendance
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')
        OR public.has_role(auth.uid(), 'principal')
        OR public.has_role(auth.uid(), 'ib_coordinator')
        OR public.has_role(auth.uid(), 'office_admin')
      )
      AND public.has_student_institution_access(auth.uid(), student_id)
    )
  );

DROP POLICY IF EXISTS "Teachers view own class attendance" ON public.daily_attendance;
CREATE POLICY "Teachers view own class attendance" ON public.daily_attendance
  FOR SELECT TO authenticated
  USING (
    (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'faculty'))
    AND public.teaches_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Institution faculty can insert attendance" ON public.daily_attendance;
CREATE POLICY "Institution faculty can insert attendance" ON public.daily_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')
        OR public.has_role(auth.uid(), 'ib_coordinator')
      )
      AND public.has_student_institution_access(auth.uid(), student_id)
    )
    OR (
      (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'faculty'))
      AND public.teaches_student(auth.uid(), student_id)
    )
  );

DROP POLICY IF EXISTS "Institution faculty can update attendance" ON public.daily_attendance;
CREATE POLICY "Institution faculty can update attendance" ON public.daily_attendance
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')
        OR public.has_role(auth.uid(), 'ib_coordinator')
      )
      AND public.has_student_institution_access(auth.uid(), student_id)
    )
    OR (
      (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'faculty'))
      AND public.teaches_student(auth.uid(), student_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')
        OR public.has_role(auth.uid(), 'ib_coordinator')
      )
      AND public.has_student_institution_access(auth.uid(), student_id)
    )
    OR (
      (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'faculty'))
      AND public.teaches_student(auth.uid(), student_id)
    )
  );

DROP POLICY IF EXISTS "Staff can manage exam records" ON public.exam_records;
CREATE POLICY "Staff can manage exam records" ON public.exam_records
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
  );

DROP POLICY IF EXISTS "Teachers manage own class exam records" ON public.exam_records;
CREATE POLICY "Teachers manage own class exam records" ON public.exam_records
  FOR ALL TO authenticated
  USING (
    (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'faculty'))
    AND public.teaches_student(auth.uid(), student_id)
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'faculty'))
    AND public.teaches_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS te_inst_admin_write ON public.timetable_entries;
CREATE POLICY te_inst_admin_write ON public.timetable_entries
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR 'timetable:edit' = ANY (public.get_user_permissions(auth.uid()))
    OR (batch_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.batches b
      JOIN public.courses c ON c.id = b.course_id
      JOIN public.departments d ON d.id = c.department_id
      WHERE b.id = timetable_entries.batch_id
        AND public.has_institution_access(auth.uid(), d.institution_id)
    ))
    OR (merge_group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.class_merge_groups g
      WHERE g.id = timetable_entries.merge_group_id
        AND public.has_institution_access(auth.uid(), g.institution_id)
    ))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR 'timetable:edit' = ANY (public.get_user_permissions(auth.uid()))
    OR (batch_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.batches b
      JOIN public.courses c ON c.id = b.course_id
      JOIN public.departments d ON d.id = c.department_id
      WHERE b.id = timetable_entries.batch_id
        AND public.has_institution_access(auth.uid(), d.institution_id)
    ))
    OR (merge_group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.class_merge_groups g
      WHERE g.id = timetable_entries.merge_group_id
        AND public.has_institution_access(auth.uid(), g.institution_id)
    ))
  );

DROP POLICY IF EXISTS tsub_inst_admin_write ON public.timetable_substitutions;
CREATE POLICY tsub_inst_admin_write ON public.timetable_substitutions
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR 'timetable:substitute' = ANY (public.get_user_permissions(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.timetable_entries te
      LEFT JOIN public.batches b ON b.id = te.batch_id
      LEFT JOIN public.courses c ON c.id = b.course_id
      LEFT JOIN public.departments d ON d.id = c.department_id
      LEFT JOIN public.class_merge_groups g ON g.id = te.merge_group_id
      WHERE te.id = timetable_substitutions.timetable_entry_id
        AND (
          (d.institution_id IS NOT NULL AND public.has_institution_access(auth.uid(), d.institution_id))
          OR (g.institution_id IS NOT NULL AND public.has_institution_access(auth.uid(), g.institution_id))
        )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR 'timetable:substitute' = ANY (public.get_user_permissions(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.timetable_entries te
      LEFT JOIN public.batches b ON b.id = te.batch_id
      LEFT JOIN public.courses c ON c.id = b.course_id
      LEFT JOIN public.departments d ON d.id = c.department_id
      LEFT JOIN public.class_merge_groups g ON g.id = te.merge_group_id
      WHERE te.id = timetable_substitutions.timetable_entry_id
        AND (
          (d.institution_id IS NOT NULL AND public.has_institution_access(auth.uid(), d.institution_id))
          OR (g.institution_id IS NOT NULL AND public.has_institution_access(auth.uid(), g.institution_id))
        )
    )
  );

INSERT INTO public.permissions (module, action, description) VALUES
  ('attendance',  'mark',       'Mark and edit student attendance for own classes'),
  ('marks',       'view',       'View marks and assessments'),
  ('marks',       'enter',      'Enter marks for allocated subjects'),
  ('marks',       'publish',    'Publish results / report cards'),
  ('timetable',   'substitute', 'Submit and approve lecture substitutions'),
  ('hr',          'self',       'Self-service HR only: own attendance, own leave, directory, holidays')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'teacher'::public.app_role, p.id
FROM public.permissions p
WHERE (p.module, p.action) IN (
  ('dashboard','view'), ('search','view'), ('students','view'),
  ('attendance','view'), ('attendance','mark'),
  ('marks','view'), ('marks','enter'),
  ('timetable','view'),
  ('library','view'),
  ('documents','view'), ('documents','upload'),
  ('hr','self')
)
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'school_coordinator'::public.app_role, p.id
FROM public.permissions p
WHERE (p.module, p.action) IN (
  ('attendance','mark'),
  ('marks','view'), ('marks','enter'), ('marks','publish'),
  ('timetable','view'), ('timetable','edit'), ('timetable','substitute'),
  ('library','view'),
  ('hr','self')
)
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'non_teaching'::public.app_role, p.id
FROM public.permissions p
WHERE (p.module, p.action) = ('hr','self')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT r.role::public.app_role, p.id
FROM public.permissions p
CROSS JOIN (VALUES
  ('campus_admin'), ('principal'), ('admission_head'), ('counsellor'),
  ('accountant'), ('faculty'), ('teacher'), ('data_entry'),
  ('office_admin'), ('office_assistant'), ('school_coordinator'),
  ('hostel_warden'), ('librarian'), ('ib_coordinator'), ('video_editor'),
  ('non_teaching')
) AS r(role)
WHERE (p.module, p.action) = ('hr','self')
ON CONFLICT (role, permission_id) DO NOTHING;
