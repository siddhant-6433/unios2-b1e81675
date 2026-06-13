-- Office Assistant role hardening.
--
-- Office assistants may view student/candidate records and fee details for
-- their assigned branch, but they must not create fee rows or financial
-- transactions. Student/parent mobile changes go through principal/super_admin
-- approval and are applied by RPC after approval.

-- Assigned branch helper: today staff assignment is stored as profiles.campus
-- (campus name or code). Keep it small and explicit rather than adding a new
-- assignment table in this feature migration.
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

CREATE OR REPLACE FUNCTION public.application_branch_campus_id(_lead_id uuid, _course_selections jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus_id uuid;
BEGIN
  IF _lead_id IS NOT NULL THEN
    SELECT campus_id INTO v_campus_id
    FROM public.leads
    WHERE id = _lead_id;
    IF v_campus_id IS NOT NULL THEN
      RETURN v_campus_id;
    END IF;
  END IF;

  IF jsonb_typeof(_course_selections) = 'array' AND jsonb_array_length(_course_selections) > 0 THEN
    BEGIN
      v_campus_id := NULLIF(_course_selections->0->>'campus_id', '')::uuid;
      RETURN v_campus_id;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.application_branch_campus_id(uuid, jsonb) TO authenticated;

-- Permission seeds.
INSERT INTO public.permissions (module, action, description) VALUES
  ('student_contact_changes', 'view', 'View student contact change requests'),
  ('student_contact_changes', 'create', 'Request student/parent mobile number changes'),
  ('student_contact_changes', 'review', 'Approve or reject student contact change requests'),
  ('timetable', 'view', 'View timetable and lecture assignments'),
  ('timetable', 'edit', 'Assign lectures to faculty')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE
  v_perm uuid;
BEGIN
  -- Office Assistant default access.
  FOR v_perm IN
    SELECT id FROM public.permissions
    WHERE (module, action) IN (
      ('dashboard', 'view'),
      ('search', 'view'),
      ('students', 'view'),
      ('attendance', 'view'),
      ('documents', 'view'),
      ('documents', 'upload'),
      ('finance', 'view'),
      ('courses_fees', 'view'),
      ('student_contact_changes', 'view'),
      ('student_contact_changes', 'create'),
      ('timetable', 'view'),
      ('timetable', 'edit')
    )
  LOOP
    INSERT INTO public.role_permissions (role, permission_id)
    VALUES ('office_assistant'::app_role, v_perm)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Principal and super_admin can review contact change requests.
  FOR v_perm IN
    SELECT id FROM public.permissions
    WHERE module = 'student_contact_changes'
  LOOP
    INSERT INTO public.role_permissions (role, permission_id)
    VALUES ('principal'::app_role, v_perm)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.role_permissions (role, permission_id)
    VALUES ('super_admin'::app_role, v_perm)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Students: replace broad office_assistant FOR ALL access with branch-scoped
-- SELECT only. Existing write-capable staff keep INSERT/UPDATE access.
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
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin')
  )
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

-- Applications/candidate records: office assistant read is branch-scoped, and
-- office assistants are not in the staff update policy. Applicant self-update
-- policies remain separate for the public apply flow.
DROP POLICY IF EXISTS "Anyone can update applications" ON public.applications;
DROP POLICY IF EXISTS "Applicants can update own applications" ON public.applications;

DROP POLICY IF EXISTS "Staff view all applications" ON public.applications;
CREATE POLICY "Staff view all applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
    OR public.has_role(auth.uid(), 'office_admin'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
    OR public.has_role(auth.uid(), 'data_entry'::app_role)
    OR (
      public.has_role(auth.uid(), 'office_assistant'::app_role)
      AND public.user_can_access_assigned_campus(
        auth.uid(),
        public.application_branch_campus_id(applications.lead_id, applications.course_selections)
      )
    )
  );

DROP POLICY IF EXISTS "Staff update applications" ON public.applications;
CREATE POLICY "Staff update applications"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
    OR public.has_role(auth.uid(), 'office_admin'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
    OR public.has_role(auth.uid(), 'office_admin'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  );

-- Finance read access for office_assistant is branch-scoped. Financial writes
-- are deliberately not granted to office_assistant.
DROP POLICY IF EXISTS "Finance staff can view all ledger" ON public.fee_ledger;
DROP POLICY IF EXISTS "Office assistants view assigned branch ledger" ON public.fee_ledger;
CREATE POLICY "Finance staff can view all ledger" ON public.fee_ledger
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'principal') OR
    (
      public.has_role(auth.uid(), 'office_assistant')
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = fee_ledger.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

DROP POLICY IF EXISTS "Finance staff can view payments" ON public.payments;
CREATE POLICY "Finance staff can view payments" ON public.payments
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    (
      public.has_role(auth.uid(), 'office_assistant')
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = payments.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

DROP POLICY IF EXISTS "Finance staff can view ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Finance staff can view ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'principal') OR
    (
      public.has_role(auth.uid(), 'office_assistant')
      AND EXISTS (
        SELECT 1
        FROM public.fee_ledger fl
        JOIN public.students s ON s.id = fl.student_id
        WHERE fl.id = fee_ledger_payments.fee_ledger_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

DROP POLICY IF EXISTS "Staff can read lead_payments" ON public.lead_payments;
DROP POLICY IF EXISTS "Staff can insert lead_payments" ON public.lead_payments;
DROP POLICY IF EXISTS "Staff can update lead_payments" ON public.lead_payments;

CREATE POLICY "Staff can read lead_payments" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    (
      public.has_role(auth.uid(), 'office_assistant')
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_payments.lead_id
          AND public.user_can_access_assigned_campus(auth.uid(), l.campus_id)
      )
    )
  );

CREATE POLICY "Staff can insert lead_payments" ON public.lead_payments
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

CREATE POLICY "Staff can update lead_payments" ON public.lead_payments
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin')
  )
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

-- Attendance: office assistant can view assigned branch attendance.
DROP POLICY IF EXISTS "Office assistants view assigned branch attendance" ON public.daily_attendance;
CREATE POLICY "Office assistants view assigned branch attendance"
  ON public.daily_attendance FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'office_assistant')
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = daily_attendance.student_id
        AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
    )
  );

-- Contact change requests.
CREATE TABLE IF NOT EXISTS public.student_contact_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  field_name text NOT NULL CHECK (
    field_name IN (
      'phone', 'whatsapp_no',
      'father_phone', 'father_whatsapp',
      'mother_phone', 'mother_whatsapp',
      'guardian_phone'
    )
  ),
  old_value text,
  new_value text NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_by_name text,
  requested_by_role text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_by_name text,
  reviewed_by_role text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_contact_change_requests_student
  ON public.student_contact_change_requests(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_contact_change_requests_pending
  ON public.student_contact_change_requests(status)
  WHERE status = 'pending';

ALTER TABLE public.student_contact_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read student contact change requests" ON public.student_contact_change_requests;
CREATE POLICY "Staff read student contact change requests"
  ON public.student_contact_change_requests FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    requested_by = auth.uid() OR
    (
      public.has_role(auth.uid(), 'office_assistant')
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = student_contact_change_requests.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

DROP POLICY IF EXISTS "Office assistants create student contact change requests" ON public.student_contact_change_requests;
CREATE POLICY "Office assistants create student contact change requests"
  ON public.student_contact_change_requests FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'office_assistant') OR
      public.has_role(auth.uid(), 'office_admin') OR
      public.has_role(auth.uid(), 'principal') OR
      public.has_role(auth.uid(), 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Approvers review student contact change requests" ON public.student_contact_change_requests;
CREATE POLICY "Approvers review student contact change requests"
  ON public.student_contact_change_requests FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal')
  );

GRANT SELECT, INSERT, UPDATE ON public.student_contact_change_requests TO authenticated;
GRANT ALL ON public.student_contact_change_requests TO service_role;

CREATE OR REPLACE FUNCTION public.request_student_contact_change(
  _student_id uuid,
  _field_name text,
  _new_value text,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_user_role text;
  v_old_value text;
  v_request_id uuid;
  v_student_campus uuid;
BEGIN
  IF _field_name NOT IN (
    'phone', 'whatsapp_no',
    'father_phone', 'father_whatsapp',
    'mother_phone', 'mother_whatsapp',
    'guardian_phone'
  ) THEN
    RAISE EXCEPTION 'Unsupported contact field';
  END IF;

  IF NULLIF(btrim(_new_value), '') IS NULL THEN
    RAISE EXCEPTION 'New value is required';
  END IF;

  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT campus_id INTO v_student_campus
  FROM public.students
  WHERE id = _student_id;

  IF v_student_campus IS NULL THEN
    RAISE EXCEPTION 'Student not found or has no campus';
  END IF;

  IF NOT (
    public.has_role(v_user_id, 'super_admin') OR
    public.has_role(v_user_id, 'principal') OR
    public.has_role(v_user_id, 'office_admin') OR
    (
      public.has_role(v_user_id, 'office_assistant')
      AND public.user_can_access_assigned_campus(v_user_id, v_student_campus)
    )
  ) THEN
    RAISE EXCEPTION 'Insufficient permission to request this contact change';
  END IF;

  EXECUTE format('SELECT %I::text FROM public.students WHERE id = $1', _field_name)
    INTO v_old_value
    USING _student_id;

  SELECT display_name INTO v_user_name FROM public.profiles WHERE user_id = v_user_id;
  SELECT role::text INTO v_user_role FROM public.user_roles WHERE user_id = v_user_id LIMIT 1;

  INSERT INTO public.student_contact_change_requests (
    student_id, field_name, old_value, new_value, reason,
    requested_by, requested_by_name, requested_by_role
  ) VALUES (
    _student_id, _field_name, v_old_value, btrim(_new_value), btrim(_reason),
    v_user_id, v_user_name, v_user_role
  ) RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_student_contact_change(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_student_contact_change_request(
  _request_id uuid,
  _decision text,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_user_role text;
  v_req public.student_contact_change_requests%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(v_user_id, 'super_admin') OR
    public.has_role(v_user_id, 'principal')
  ) THEN
    RAISE EXCEPTION 'Only principal or super admin can review student contact changes';
  END IF;

  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected';
  END IF;

  SELECT * INTO v_req
  FROM public.student_contact_change_requests
  WHERE id = _request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already %', v_req.status;
  END IF;

  SELECT display_name INTO v_user_name FROM public.profiles WHERE user_id = v_user_id;
  SELECT role::text INTO v_user_role FROM public.user_roles WHERE user_id = v_user_id LIMIT 1;

  IF _decision = 'approved' THEN
    EXECUTE format('UPDATE public.students SET %I = $1, updated_at = now() WHERE id = $2', v_req.field_name)
      USING v_req.new_value, v_req.student_id;
  END IF;

  UPDATE public.student_contact_change_requests
  SET status = _decision,
      reviewed_by = v_user_id,
      reviewed_by_name = v_user_name,
      reviewed_by_role = v_user_role,
      reviewed_at = now(),
      review_notes = _notes
  WHERE id = _request_id;

  RETURN jsonb_build_object('status', _decision);
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_student_contact_change_request(uuid, text, text) TO authenticated;

-- Add contact changes to the unified approvals feed.
CREATE OR REPLACE VIEW public.pending_approvals AS
SELECT
  'concession'::text AS kind,
  c.id::text AS id,
  c.status AS status,
  c.student_id::text AS subject_id,
  s.name AS subject_name,
  c.type AS detail_type,
  c.value AS detail_value,
  c.reason AS reason,
  c.requested_by::text AS requested_by_id,
  c.created_at AS created_at,
  CASE
    WHEN c.status = 'pending_principal' THEN 'principal'
    WHEN c.status = 'pending_super_admin' THEN 'super_admin'
    ELSE NULL
  END AS pending_role
FROM public.concessions c
LEFT JOIN public.students s ON s.id = c.student_id
WHERE c.status IN ('pending_principal', 'pending_super_admin')

UNION ALL

SELECT
  'offer_letter'::text AS kind,
  ol.id::text AS id,
  ol.approval_status AS status,
  ol.lead_id::text AS subject_id,
  l.name AS subject_name,
  'flat'::text AS detail_type,
  ol.net_fee AS detail_value,
  NULL::text AS reason,
  ol.issued_by::text AS requested_by_id,
  ol.created_at AS created_at,
  'principal'::text AS pending_role
FROM public.offer_letters ol
LEFT JOIN public.leads l ON l.id = ol.lead_id
WHERE ol.approval_status = 'pending_principal'

UNION ALL

SELECT
  'offer_edit'::text AS kind,
  er.id::text AS id,
  er.status AS status,
  ol.lead_id::text AS subject_id,
  l.name AS subject_name,
  'edit_request'::text AS detail_type,
  NULL::numeric AS detail_value,
  er.reason AS reason,
  er.requested_by::text AS requested_by_id,
  er.created_at AS created_at,
  'super_admin'::text AS pending_role
FROM public.offer_letter_edit_requests er
JOIN public.offer_letters ol ON ol.id = er.offer_letter_id
LEFT JOIN public.leads l ON l.id = ol.lead_id
WHERE er.status = 'pending'

UNION ALL

SELECT
  'student_contact_change'::text AS kind,
  scr.id::text AS id,
  scr.status AS status,
  scr.student_id::text AS subject_id,
  s.name AS subject_name,
  scr.field_name AS detail_type,
  NULL::numeric AS detail_value,
  scr.reason AS reason,
  scr.requested_by::text AS requested_by_id,
  scr.created_at AS created_at,
  'principal'::text AS pending_role
FROM public.student_contact_change_requests scr
LEFT JOIN public.students s ON s.id = scr.student_id
WHERE scr.status = 'pending'

UNION ALL

SELECT
  'lead_deletion'::text AS kind,
  ldr.id::text AS id,
  'pending_admin'::text AS status,
  ldr.lead_id::text AS subject_id,
  l.name AS subject_name,
  ldr.reason AS detail_type,
  NULL::numeric AS detail_value,
  ldr.custom_message AS reason,
  ldr.requested_by::text AS requested_by_id,
  ldr.created_at AS created_at,
  'super_admin'::text AS pending_role
FROM public.lead_deletion_requests ldr
LEFT JOIN public.leads l ON l.id = ldr.lead_id
WHERE ldr.status = 'pending';

GRANT SELECT ON public.pending_approvals TO authenticated;

-- Optional timetable/lecture tables exist in some deployed databases, but the
-- historical migration is a local stub. Seed policies when those tables are
-- present without failing fresh local databases.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['timetable_slots', 'class_lectures', 'lecture_attendance'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    END IF;
  END LOOP;
END $$;
