-- Round 2: split the nodal (class) teacher from the subject teacher, and stop
-- leaking student PII to whoever happens to teach one of their subjects.
--
-- Round 1 modelled "teacher" as one thing: teaches_student() OR'd class_teachers
-- and subject_allocations, so a subject teacher got exactly the access a class
-- teacher gets. In an Indian school those are different jobs -- the class
-- teacher is the nodal teacher who carries the pastoral/admin load for a
-- section, on top of teaching their own subject.
--
-- Concretely, round 1 also granted `teacher` students:view + documents:upload,
-- and src/pages/StudentProfile.tsx has no per-section gating at all. So today
-- any subject teacher can read Aadhaar numbers, parents' income, banking and
-- medical details of every student they can see, and upload documents onto them.
--
-- Role intent from here: `teacher` = school, `faculty` = college.

-- ---------------------------------------------------------------------------
-- 1. Two primitives instead of one
-- ---------------------------------------------------------------------------

-- Nodal. Class teacher of this student's batch/section.
CREATE OR REPLACE FUNCTION public.is_class_teacher_of(_user_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students st
    JOIN public.class_teachers ct
      ON ct.batch_id = st.batch_id
     AND ct.active
     AND (ct.section    IS NULL OR ct.section    = st.section)
     AND (ct.session_id IS NULL OR ct.session_id = st.session_id)
    WHERE st.id = _student_id
      AND ct.teacher_user_id = _user_id
  );
$$;

-- Subject teacher. Holds an allocation covering this student's batch/section.
CREATE OR REPLACE FUNCTION public.teaches_subject_of(_user_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students st
    JOIN public.subject_allocations sa
      ON sa.batch_id = st.batch_id
     AND sa.active
     AND (sa.section    IS NULL OR sa.section    = st.section)
     AND (sa.session_id IS NULL OR sa.session_id = st.session_id)
    WHERE st.id = _student_id
      AND sa.faculty_user_id = _user_id
  );
$$;

-- Unchanged contract -- "may this person see this student at all" -- now
-- expressed as the union. Every round-1 policy keeps working untouched.
CREATE OR REPLACE FUNCTION public.teaches_student(_user_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_class_teacher_of(_user_id, _student_id)
      OR public.teaches_subject_of(_user_id, _student_id);
$$;

COMMENT ON FUNCTION public.teaches_student(uuid, uuid) IS
  'Row gate: may this user see this student at all. For "how much of the student", use is_class_teacher_of().';

-- ---------------------------------------------------------------------------
-- 2. New permissions
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (module, action, description) VALUES
  ('students', 'view_contact',   'See student/parent phone, email and address'),
  ('students', 'view_medical',   'See blood group, allergies and medical history'),
  ('students', 'view_sensitive', 'See Aadhaar, parent income, banking, caste and fee remarks'),
  ('marks',    'view_class',     'View all subjects for the class you are class teacher of'),
  ('attendance', 'mark_daily',   'Mark whole-day attendance for your class (school)'),
  ('attendance', 'mark_period',  'Mark per-lecture attendance for your own periods (college)'),
  ('report_cards', 'sign_off',   'Class teacher sign-off on a report card')
ON CONFLICT (module, action) DO NOTHING;

-- Office/admin roles: full student record.
INSERT INTO public.role_permissions (role, permission_id)
SELECT r.role::public.app_role, p.id
FROM public.permissions p
CROSS JOIN (VALUES
  ('campus_admin'), ('principal'), ('office_admin'), ('office_assistant'),
  ('school_coordinator'), ('data_entry')
) AS r(role)
WHERE (p.module, p.action) IN (
  ('students','view_contact'), ('students','view_medical'), ('students','view_sensitive')
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Class teachers need contact + medical to do the nodal job (reach a parent,
-- know about an allergy). They never need Aadhaar, income or banking.
-- The permission is per-user; student_profile_for_viewer() additionally
-- requires is_class_teacher_of() for THIS student, so a class teacher of 9-A
-- cannot read 9-B's parent numbers just by also teaching 9-B a subject.
INSERT INTO public.role_permissions (role, permission_id)
SELECT r.role::public.app_role, p.id
FROM public.permissions p
CROSS JOIN (VALUES ('teacher'), ('faculty')) AS r(role)
WHERE (p.module, p.action) IN (
  ('students','view_contact'), ('students','view_medical'),
  ('marks','view_class'), ('report_cards','sign_off')
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Attendance granularity: school takes it class-wise (the class teacher marks
-- the whole day), college takes it per lecture (each faculty marks their own
-- period, so a student can be present in one subject and absent in another).
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'teacher'::public.app_role, p.id
FROM public.permissions p WHERE (p.module, p.action) = ('attendance','mark_daily')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'faculty'::public.app_role, p.id
FROM public.permissions p WHERE (p.module, p.action) = ('attendance','mark_period')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT r.role::public.app_role, p.id
FROM public.permissions p
CROSS JOIN (VALUES ('school_coordinator'), ('principal'), ('campus_admin')) AS r(role)
WHERE (p.module, p.action) IN (('attendance','mark_daily'), ('attendance','mark_period'))
ON CONFLICT (role, permission_id) DO NOTHING;

-- Round 1 over-granted: a subject teacher could upload documents onto any
-- student they could see. Documents stay readable, uploads go back to office.
DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE p.id = rp.permission_id
  AND rp.role IN ('teacher', 'faculty')
  AND (p.module, p.action) = ('documents','upload');

-- attendance:mark from round 1 is superseded by mark_daily / mark_period.
-- Nothing reads it any more; leaving it granted would show a permission in the
-- matrix that changes nothing. role_permissions cascades on permission_id.
DELETE FROM public.permissions WHERE (module, action) = ('attendance','mark');

-- ---------------------------------------------------------------------------
-- 3. Shape the student record to the viewer
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: the round-1 RLS on `students` already decides
-- WHICH students you may see, and it is the tested path. This function only
-- decides HOW MUCH of one you get, so it must not bypass RLS -- a DEFINER here
-- would mean re-implementing the row gate and getting it subtly wrong.
--
-- Fields you may not see are ABSENT from the payload, not null, so the UI
-- cannot leak them by rendering a field it forgot to hide.

CREATE OR REPLACE FUNCTION public.student_profile_for_viewer(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  s             public.students%ROWTYPE;
  v_perms       text[];
  v_super       boolean;
  v_teacher     boolean;   -- scoped teaching role (teacher/faculty)
  v_nodal       boolean;   -- class teacher of THIS student
  v_contact     boolean;
  v_medical     boolean;
  v_sensitive   boolean;
  v_out         jsonb;
BEGIN
  -- RLS applies here. No row => caller may not see this student at all.
  SELECT * INTO s FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_super   := public.has_role(auth.uid(), 'super_admin');
  v_perms   := public.get_user_permissions(auth.uid());
  v_teacher := public.has_role(auth.uid(), 'teacher')
            OR public.has_role(auth.uid(), 'faculty');
  v_nodal   := public.is_class_teacher_of(auth.uid(), _student_id);

  -- A teaching role gets the extra fields only for their OWN class. Everyone
  -- else (office, admin) gets them wherever RLS already let them see the row.
  v_contact   := v_super OR ('students:view_contact'   = ANY(v_perms) AND (NOT v_teacher OR v_nodal));
  v_medical   := v_super OR ('students:view_medical'   = ANY(v_perms) AND (NOT v_teacher OR v_nodal));
  -- Never granted to teacher/faculty, but belt and braces.
  v_sensitive := v_super OR ('students:view_sensitive' = ANY(v_perms) AND NOT v_teacher);

  -- Roster baseline: enough to teach and take a register.
  v_out := jsonb_build_object(
    'id', s.id, 'name', s.name,
    'first_name', s.first_name, 'middle_name', s.middle_name, 'last_name', s.last_name,
    'admission_no', s.admission_no, 'pre_admission_no', s.pre_admission_no,
    'school_admission_no', s.school_admission_no, 'sr_number', s.sr_number,
    'class_roll_no', s.class_roll_no, 'section', s.section, 'joining_class', s.joining_class,
    'house', s.house, 'status', s.status, 'student_type', s.student_type,
    'gender', s.gender, 'dob', s.dob,
    'batch_id', s.batch_id, 'session_id', s.session_id,
    'course_id', s.course_id, 'campus_id', s.campus_id,
    'photo_url', s.photo_url, 'photo_processed_url', s.photo_processed_url,
    'second_language', s.second_language, 'third_language', s.third_language,
    'is_class_teacher', v_nodal
  );

  IF v_contact THEN
    v_out := v_out || jsonb_build_object(
      'phone', s.phone, 'whatsapp_no', s.whatsapp_no,
      'email', s.email, 'student_email', s.student_email, 'school_email', s.school_email,
      'address', s.address, 'city', s.city, 'state', s.state, 'pincode', s.pincode,
      'father_name', s.father_name, 'father_phone', s.father_phone,
      'father_whatsapp', s.father_whatsapp, 'father_email', s.father_email,
      'mother_name', s.mother_name, 'mother_phone', s.mother_phone,
      'mother_whatsapp', s.mother_whatsapp, 'mother_email', s.mother_email,
      'guardian_name', s.guardian_name, 'guardian_phone', s.guardian_phone,
      'mother_tongue', s.mother_tongue
    );
  END IF;

  IF v_medical THEN
    v_out := v_out || jsonb_build_object(
      'blood_group', s.blood_group,
      'allergies_food', s.allergies_food, 'allergies_medicine', s.allergies_medicine,
      'medical_ailments', s.medical_ailments, 'ongoing_treatment', s.ongoing_treatment,
      'physical_handicap', s.physical_handicap, 'is_asthmatic', s.is_asthmatic,
      'vision', s.vision
    );
  END IF;

  IF v_sensitive THEN
    v_out := v_out || jsonb_build_object(
      'student_aadhar', s.student_aadhar,
      'father_aadhar', s.father_aadhar, 'mother_aadhar', s.mother_aadhar,
      'father_income', s.father_income, 'father_occupation', s.father_occupation,
      'father_organization', s.father_organization, 'father_designation', s.father_designation,
      'father_qualification', s.father_qualification,
      'mother_occupation', s.mother_occupation, 'mother_organization', s.mother_organization,
      'bank_name', s.bank_name, 'bank_account_no', s.bank_account_no, 'ifsc_code', s.ifsc_code,
      'religion', s.religion, 'caste', s.caste, 'sub_caste', s.sub_caste,
      'caste_category', s.caste_category,
      'concession_category', s.concession_category, 'fee_profile_type', s.fee_profile_type,
      'fee_remarks', s.fee_remarks, 'rte_student', s.rte_student,
      'biometric_id', s.biometric_id, 'apaar_id', s.apaar_id,
      'pen', s.pen, 'udise', s.udise,
      'identification_marks_1', s.identification_marks_1,
      'identification_marks_2', s.identification_marks_2
    );
  END IF;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.student_profile_for_viewer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.student_profile_for_viewer(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Report card sign-off
-- ---------------------------------------------------------------------------
-- Mirrors the working IB workflow (ib_report_cards.status, migration
-- 20260505100000) which already models subject-teacher-submits ->
-- nodal-reviews -> published.

ALTER TABLE public.report_cards
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS class_teacher_comment text,
  ADD COLUMN IF NOT EXISTS coordinator_comment text,
  ADD COLUMN IF NOT EXISTS signed_off_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS signed_off_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_cards_status_check'
  ) THEN
    ALTER TABLE public.report_cards
      ADD CONSTRAINT report_cards_status_check
      CHECK (status IN ('draft','class_teacher_review','coordinator_review','published'));
  END IF;
END $$;

-- Class teacher signs off their own class; coordinator/principal publishes.
DROP POLICY IF EXISTS rc_class_teacher_signoff ON public.report_cards;
CREATE POLICY rc_class_teacher_signoff ON public.report_cards
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR ('report_cards:sign_off' = ANY (public.get_user_permissions(auth.uid()))
        AND public.is_class_teacher_of(auth.uid(), student_id))
    OR 'marks:publish' = ANY (public.get_user_permissions(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR ('report_cards:sign_off' = ANY (public.get_user_permissions(auth.uid()))
        AND public.is_class_teacher_of(auth.uid(), student_id))
    OR 'marks:publish' = ANY (public.get_user_permissions(auth.uid()))
  );

DROP POLICY IF EXISTS rc_staff_insert ON public.report_cards;
CREATE POLICY rc_staff_insert ON public.report_cards
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR 'marks:enter' = ANY (public.get_user_permissions(auth.uid()))
  );

-- Class teachers can read their own class's report cards even before publish.
DROP POLICY IF EXISTS rc_class_teacher_read ON public.report_cards;
CREATE POLICY rc_class_teacher_read ON public.report_cards
  FOR SELECT TO authenticated
  USING (public.is_class_teacher_of(auth.uid(), student_id));
