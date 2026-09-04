-- ====================================================================
-- Disable login for an individual STUDENT (super_admin only).
--   When disabled the student cannot log in (enforced in the login edge
--   functions) AND loses all data access instantly — even with a still-valid
--   JWT — because every student-self RLS branch and the fee-receipts RPC now
--   require `NOT login_disabled`.
--   Consultants already have this via profiles.login_disabled + the
--   toggle-user-login edge function; this migration is students-only.
--   Scope is the student's OWN access; parent/guardian branches are untouched.
-- ====================================================================

-- ── 1. Flag ─────────────────────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS login_disabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_students_login_disabled
  ON public.students (login_disabled) WHERE login_disabled = true;

-- ── 2. Admin toggle (super_admin only) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_student_login_disabled(
  _student_id uuid,
  _disabled   boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_old     boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can change student login access';
  END IF;

  SELECT user_id, login_disabled INTO v_user_id, v_old
    FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  UPDATE public.students
     SET login_disabled = _disabled
   WHERE id = _student_id;

  -- Kick out any live session immediately. Caller is super_admin, so the
  -- nested guard in admin_revoke_user_sessions passes.
  IF _disabled AND v_user_id IS NOT NULL THEN
    PERFORM public.admin_revoke_user_sessions(v_user_id);
  END IF;

  INSERT INTO public.student_audit_log
    (student_id, actor_user_id, event_type, field_name, old_value, new_value)
  VALUES
    (_student_id, auth.uid(),
     CASE WHEN _disabled THEN 'login_disabled' ELSE 'login_enabled' END,
     'login_disabled', COALESCE(v_old, false)::text, _disabled::text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_student_login_disabled(uuid, boolean) TO authenticated;

-- ── 3. student_fee_due_summary — SECURITY DEFINER, bypasses RLS, so it needs
--       its own guard. Refuse when the caller IS the student and is disabled.
--       (Full body reproduced from live definition + the new guard.) ─────────
CREATE OR REPLACE FUNCTION public.student_fee_due_summary(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_due      numeric;
  v_receipts jsonb;
BEGIN
  IF NOT public.is_family_of_student(_student_id) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  -- Instant cutoff: a disabled student cannot read their own fees/receipts.
  IF EXISTS (
    SELECT 1 FROM public.students s
     WHERE s.id = _student_id AND s.user_id = auth.uid() AND s.login_disabled
  ) THEN
    RAISE EXCEPTION 'Login disabled';
  END IF;

  SELECT COALESCE(SUM(fl.balance) FILTER (WHERE fl.status IN ('due','overdue')), 0)
    INTO v_due FROM public.fee_ledger fl WHERE fl.student_id = _student_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'receipt_no', lp.receipt_no, 'amount', lp.amount, 'type', lp.type,
           'payment_date', lp.payment_date, 'receipt_url', lp.receipt_url
         ) ORDER BY lp.payment_date DESC), '[]'::jsonb)
    INTO v_receipts
    FROM public.lead_payments lp
    JOIN public.students s ON s.lead_id = lp.lead_id
   WHERE s.id = _student_id AND lp.status = 'confirmed';

  RETURN jsonb_build_object('due_total', v_due, 'receipts', v_receipts);
END;
$function$;

-- ── 4. student_profile_for_viewer — SECURITY INVOKER (relies on students RLS,
--       so a disabled student already gets NULL). Just surface the flag for the
--       admin UI badge. (Full body reproduced + one field.) ─────────────────
CREATE OR REPLACE FUNCTION public.student_profile_for_viewer(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  s             public.students%ROWTYPE;
  v_perms       text[];
  v_super       boolean;
  v_teacher     boolean;
  v_nodal       boolean;
  v_contact     boolean;
  v_medical     boolean;
  v_sensitive   boolean;
  v_out         jsonb;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_super   := public.has_role(auth.uid(), 'super_admin');
  v_perms   := public.get_user_permissions(auth.uid());
  v_teacher := public.has_role(auth.uid(), 'teacher')
            OR public.has_role(auth.uid(), 'faculty');
  v_nodal   := public.is_class_teacher_of(auth.uid(), _student_id);

  v_contact   := v_super OR ('students:view_contact'   = ANY(v_perms) AND (NOT v_teacher OR v_nodal));
  v_medical   := v_super OR ('students:view_medical'   = ANY(v_perms) AND (NOT v_teacher OR v_nodal));
  v_sensitive := v_super OR ('students:view_sensitive' = ANY(v_perms) AND NOT v_teacher);

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
    'is_class_teacher', v_nodal,
    'login_disabled', s.login_disabled
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
$function$;

-- ── 5. Gate the student-self RLS branches with `NOT login_disabled`.
--       Primary gate is on the students table (child-table policies read
--       students via subquery and inherit its RLS); child self-policies are
--       gated too as defense-in-depth. Quals reproduced from live definitions.
-- ====================================================================

-- students: dedicated self-policy
DROP POLICY IF EXISTS "Students can view own row" ON public.students;
CREATE POLICY "Students can view own row" ON public.students
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND NOT login_disabled);

-- students: the omnibus staff policy (only the self-branch is gated)
DROP POLICY IF EXISTS "Staff can view students" ON public.students;
CREATE POLICY "Staff can view students" ON public.students
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'data_entry'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR (auth.uid() = user_id AND NOT login_disabled)
    OR (has_role(auth.uid(), 'office_assistant'::app_role) AND user_can_access_assigned_campus(auth.uid(), campus_id))
  );

-- fee_ledger
DROP POLICY IF EXISTS "Students can view own ledger" ON public.fee_ledger;
CREATE POLICY "Students can view own ledger" ON public.fee_ledger
  FOR SELECT TO authenticated
  USING (
    (EXISTS ( SELECT 1 FROM students s
        WHERE s.id = fee_ledger.student_id AND s.user_id = auth.uid() AND NOT s.login_disabled))
    AND (NOT is_fee_hidden_for_student(student_id))
  );

-- fee_ledger_payments
DROP POLICY IF EXISTS "Students view own ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Students view own ledger payments" ON public.fee_ledger_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS ( SELECT 1 FROM fee_ledger fl JOIN students s ON s.id = fl.student_id
        WHERE fl.id = fee_ledger_payments.fee_ledger_id AND s.user_id = auth.uid() AND NOT s.login_disabled)
  );

-- payments
DROP POLICY IF EXISTS "Students can view own payments" ON public.payments;
CREATE POLICY "Students can view own payments" ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS ( SELECT 1 FROM students s
        WHERE s.id = payments.student_id AND s.user_id = auth.uid() AND NOT s.login_disabled)
  );

-- daily_attendance
DROP POLICY IF EXISTS "Students can view own attendance" ON public.daily_attendance;
CREATE POLICY "Students can view own attendance" ON public.daily_attendance
  FOR SELECT TO authenticated
  USING (
    EXISTS ( SELECT 1 FROM students s
        WHERE s.id = daily_attendance.student_id AND s.user_id = auth.uid() AND NOT s.login_disabled)
  );

-- exam_records
DROP POLICY IF EXISTS "Students can view own exams" ON public.exam_records;
CREATE POLICY "Students can view own exams" ON public.exam_records
  FOR SELECT TO authenticated
  USING (
    EXISTS ( SELECT 1 FROM students s
        WHERE s.id = exam_records.student_id AND s.user_id = auth.uid() AND NOT s.login_disabled)
  );

-- ib_report_cards
DROP POLICY IF EXISTS "Students view own published reports" ON public.ib_report_cards;
CREATE POLICY "Students view own published reports" ON public.ib_report_cards
  FOR SELECT TO authenticated
  USING (
    status = 'published'::text
    AND student_id IN ( SELECT students.id FROM students
        WHERE students.user_id = auth.uid() AND NOT students.login_disabled)
  );

-- ib_gradebook_snapshots
DROP POLICY IF EXISTS "Students read own snapshots" ON public.ib_gradebook_snapshots;
CREATE POLICY "Students read own snapshots" ON public.ib_gradebook_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id IN ( SELECT students.id FROM students
        WHERE students.user_id = auth.uid() AND NOT students.login_disabled)
  );

-- ib_portfolio_entries
DROP POLICY IF EXISTS "Students read own portfolio" ON public.ib_portfolio_entries;
CREATE POLICY "Students read own portfolio" ON public.ib_portfolio_entries
  FOR SELECT TO authenticated
  USING (
    student_id IN ( SELECT students.id FROM students
        WHERE students.user_id = auth.uid() AND NOT students.login_disabled)
  );

-- ib_myp_projects: student branch appears in two policies (ALL + SELECT)
DROP POLICY IF EXISTS "Manage projects" ON public.ib_myp_projects;
CREATE POLICY "Manage projects" ON public.ib_myp_projects
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'ib_coordinator'::app_role)
    OR has_role(auth.uid(), 'faculty'::app_role)
    OR has_role(auth.uid(), 'teacher'::app_role)
    OR (student_id IN ( SELECT students.id FROM students
          WHERE students.user_id = auth.uid() AND NOT students.login_disabled))
  );

DROP POLICY IF EXISTS "Staff read projects" ON public.ib_myp_projects;
CREATE POLICY "Staff read projects" ON public.ib_myp_projects
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'ib_coordinator'::app_role)
    OR has_role(auth.uid(), 'faculty'::app_role)
    OR has_role(auth.uid(), 'teacher'::app_role)
    OR (student_id IN ( SELECT students.id FROM students
          WHERE students.user_id = auth.uid() AND NOT students.login_disabled))
  );
