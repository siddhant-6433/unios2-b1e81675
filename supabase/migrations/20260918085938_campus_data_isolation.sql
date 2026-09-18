-- Campus Data Isolation Migration
-- Enforces that any staff member (who is not a super_admin) can ONLY view, insert, or update records
-- belonging to their assigned campuses.
-- Affected areas: leads, students, applications, fee_ledger, payments, fee_ledger_payments,
-- lead_payments, concessions, offer_waivers, offer_letters, daily_attendance, exam_records,
-- campus_visits, lead_notes, lead_followups.

-- Re-define the assigned campus helper function to robustly split comma-separated names/codes
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
    ON lower(c.name) = ANY(SELECT lower(btrim(s)) FROM unnest(string_to_array(p.campus, ',')) s)
    OR lower(c.code) = ANY(SELECT lower(btrim(s)) FROM unnest(string_to_array(p.campus, ',')) s)
  WHERE p.user_id = _user_id
    AND p.campus IS NOT NULL
    AND btrim(p.campus) <> '';
$$;

-- 1. students: Staff can view students
DROP POLICY IF EXISTS "Staff can view students" ON public.students;
CREATE POLICY "Staff can view students" ON public.students
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (auth.uid() = user_id AND NOT login_disabled)
    OR (
      (
        has_role(auth.uid(), 'campus_admin'::app_role)
        OR has_role(auth.uid(), 'principal'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR has_role(auth.uid(), 'admission_head'::app_role)
        OR has_role(auth.uid(), 'data_entry'::app_role)
        OR has_role(auth.uid(), 'office_admin'::app_role)
        OR has_role(auth.uid(), 'office_assistant'::app_role)
        OR has_role(auth.uid(), 'teacher'::app_role)
        OR has_role(auth.uid(), 'faculty'::app_role)
      )
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

-- 2. students: Staff can insert students
DROP POLICY IF EXISTS "Staff can insert students" ON public.students;
CREATE POLICY "Staff can insert students" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')   OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor')     OR
        public.has_role(auth.uid(), 'accountant')     OR
        public.has_role(auth.uid(), 'data_entry')     OR
        public.has_role(auth.uid(), 'office_admin')   OR
        public.has_role(auth.uid(), 'principal')      OR
        public.has_role(auth.uid(), 'office_assistant')
      )
      AND public.user_can_access_assigned_campus(auth.uid(), students.campus_id)
    )
  );

-- 3. students: Staff can update students
DROP POLICY IF EXISTS "Staff can update students" ON public.students;
CREATE POLICY "Staff can update students" ON public.students
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        has_role(auth.uid(), 'campus_admin'::app_role)
        OR has_role(auth.uid(), 'principal'::app_role)
        OR has_role(auth.uid(), 'admission_head'::app_role)
        OR has_role(auth.uid(), 'counsellor'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR has_role(auth.uid(), 'data_entry'::app_role)
        OR has_role(auth.uid(), 'office_admin'::app_role)
        OR has_role(auth.uid(), 'office_assistant'::app_role)
      )
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        has_role(auth.uid(), 'campus_admin'::app_role)
        OR has_role(auth.uid(), 'principal'::app_role)
        OR has_role(auth.uid(), 'admission_head'::app_role)
        OR has_role(auth.uid(), 'counsellor'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR has_role(auth.uid(), 'data_entry'::app_role)
        OR has_role(auth.uid(), 'office_admin'::app_role)
        OR has_role(auth.uid(), 'office_assistant'::app_role)
      )
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

-- 4. fee_ledger: Finance staff can view all ledger
DROP POLICY IF EXISTS "Finance staff can view all ledger" ON public.fee_ledger;
CREATE POLICY "Finance staff can view all ledger" ON public.fee_ledger
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'principal') OR
        public.has_role(auth.uid(), 'office_assistant')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = fee_ledger.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 5. fee_ledger: Finance staff can insert ledger
DROP POLICY IF EXISTS "Finance staff can insert ledger" ON public.fee_ledger;
CREATE POLICY "Finance staff can insert ledger" ON public.fee_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = fee_ledger.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 6. fee_ledger: Finance staff can update ledger
DROP POLICY IF EXISTS "Finance staff can update ledger" ON public.fee_ledger;
CREATE POLICY "Finance staff can update ledger" ON public.fee_ledger
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = fee_ledger.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = fee_ledger.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 7. payments: Finance staff can view payments
DROP POLICY IF EXISTS "Finance staff can view payments" ON public.payments;
CREATE POLICY "Finance staff can view payments" ON public.payments
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'office_assistant')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = payments.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 8. payments: Finance staff can insert payments
DROP POLICY IF EXISTS "Finance staff can insert payments" ON public.payments;
CREATE POLICY "Finance staff can insert payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'accountant')
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = payments.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 9. fee_ledger_payments: Finance staff can view ledger payments
DROP POLICY IF EXISTS "Finance staff can view ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Finance staff can view ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'principal') OR
        public.has_role(auth.uid(), 'office_assistant')
      )
      AND EXISTS (
        SELECT 1
        FROM public.fee_ledger fl
        JOIN public.students s ON s.id = fl.student_id
        WHERE fl.id = fee_ledger_payments.fee_ledger_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 10. fee_ledger_payments: Finance staff can insert ledger payments
DROP POLICY IF EXISTS "Finance staff can insert ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Finance staff can insert ledger payments" ON public.fee_ledger_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND EXISTS (
        SELECT 1
        FROM public.fee_ledger fl
        JOIN public.students s ON s.id = fl.student_id
        WHERE fl.id = fee_ledger_payments.fee_ledger_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 11. lead_payments: Staff can read lead_payments
DROP POLICY IF EXISTS "Staff can read lead_payments" ON public.lead_payments;
CREATE POLICY "Staff can read lead_payments" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'principal') OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor') OR
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'data_entry') OR
        public.has_role(auth.uid(), 'office_admin') OR
        public.has_role(auth.uid(), 'office_assistant')
      )
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_payments.lead_id
          AND public.user_can_access_assigned_campus(auth.uid(), l.campus_id)
      )
    )
  );

-- 12. lead_payments: Staff can insert lead_payments
DROP POLICY IF EXISTS "Staff can insert lead_payments" ON public.lead_payments;
CREATE POLICY "Staff can insert lead_payments" ON public.lead_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'principal') OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor') OR
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'data_entry') OR
        public.has_role(auth.uid(), 'office_admin')
      )
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_payments.lead_id
          AND public.user_can_access_assigned_campus(auth.uid(), l.campus_id)
      )
    )
  );

-- 13. concessions: concessions_select
DROP POLICY IF EXISTS "concessions_select" ON public.concessions;
CREATE POLICY "concessions_select" ON public.concessions
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'counsellor') OR
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'principal')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = concessions.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 14. concessions: concessions_insert
DROP POLICY IF EXISTS "concessions_insert" ON public.concessions;
CREATE POLICY "concessions_insert" ON public.concessions
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'counsellor') OR
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'principal')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = concessions.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 15. concessions: concessions_update
DROP POLICY IF EXISTS "concessions_update" ON public.concessions;
CREATE POLICY "concessions_update" ON public.concessions
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'principal')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = concessions.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 16. offer_waivers: Staff can view offer waivers
DROP POLICY IF EXISTS "Staff can view offer waivers" ON public.offer_waivers;
CREATE POLICY "Staff can view offer waivers"
  ON public.offer_waivers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'principal') OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor') OR
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND EXISTS (
        SELECT 1 FROM public.offer_letters ol
        WHERE ol.id = offer_waivers.offer_letter_id
          AND public.user_can_access_assigned_campus(auth.uid(), ol.campus_id)
      )
    )
  );

-- 17. leads: Staff can view leads
DROP POLICY IF EXISTS "Staff can view leads" ON public.leads;
CREATE POLICY "Staff can view leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR (
      shared_with_nimt AND (
        (
          has_role((SELECT auth.uid()), 'campus_admin'::app_role)
          OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
          OR has_role((SELECT auth.uid()), 'principal'::app_role)
          OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
          OR (
            has_role((SELECT auth.uid()), 'counsellor'::app_role)
            AND counsellor_id IN (
              SELECT profiles.id FROM profiles WHERE profiles.user_id = (SELECT auth.uid())
            )
          )
          OR can_view_lead((SELECT auth.uid()), id)
        )
        AND public.user_can_access_assigned_campus((SELECT auth.uid()), campus_id)
      )
    )
  );

-- 18. leads: Staff can insert leads
DROP POLICY IF EXISTS "Staff can insert leads" ON public.leads;
CREATE POLICY "Staff can insert leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR (
      (
        has_role((SELECT auth.uid()), 'campus_admin'::app_role)
        OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
        OR has_role((SELECT auth.uid()), 'principal'::app_role)
        OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
        OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
      )
      AND public.user_can_access_assigned_campus((SELECT auth.uid()), campus_id)
    )
  );

-- 19. leads: Staff can update leads
DROP POLICY IF EXISTS "Staff can update leads" ON public.leads;
CREATE POLICY "Staff can update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR (
      (
        has_role((SELECT auth.uid()), 'campus_admin'::app_role)
        OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
        OR has_role((SELECT auth.uid()), 'principal'::app_role)
        OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
        OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
      )
      AND public.user_can_access_assigned_campus((SELECT auth.uid()), campus_id)
    )
  )
  WITH CHECK (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR (
      (
        has_role((SELECT auth.uid()), 'campus_admin'::app_role)
        OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
        OR has_role((SELECT auth.uid()), 'principal'::app_role)
        OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
        OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
      )
      AND public.user_can_access_assigned_campus((SELECT auth.uid()), campus_id)
    )
  );

-- 20. offer_letters: Staff can select offers
DROP POLICY IF EXISTS "Staff can select offers" ON public.offer_letters;
CREATE POLICY "Staff can select offers"
  ON public.offer_letters FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')   OR
        public.has_role(auth.uid(), 'principal')      OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor')     OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

-- 21. offer_letters: Staff can insert offers
DROP POLICY IF EXISTS "Staff can insert offers" ON public.offer_letters;
CREATE POLICY "Staff can insert offers"
  ON public.offer_letters FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')   OR
        public.has_role(auth.uid(), 'principal')      OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor')     OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

-- 22. offer_letters: Staff can update offers
DROP POLICY IF EXISTS "Staff can update offers" ON public.offer_letters;
CREATE POLICY "Staff can update offers"
  ON public.offer_letters FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin')   OR
        public.has_role(auth.uid(), 'principal')      OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor')     OR
        public.has_role(auth.uid(), 'accountant')
      )
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

-- 23. daily_attendance: Staff can manage attendance
DROP POLICY IF EXISTS "Staff can manage attendance" ON public.daily_attendance;
CREATE POLICY "Staff can manage attendance" ON public.daily_attendance
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin')
    OR (
      (
        has_role(auth.uid(), 'campus_admin') OR
        has_role(auth.uid(), 'faculty') OR
        has_role(auth.uid(), 'teacher')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = daily_attendance.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 24. exam_records: Staff can manage exam records
DROP POLICY IF EXISTS "Staff can manage exam records" ON public.exam_records;
CREATE POLICY "Staff can manage exam records" ON public.exam_records
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin')
    OR (
      (
        has_role(auth.uid(), 'campus_admin') OR
        has_role(auth.uid(), 'faculty') OR
        has_role(auth.uid(), 'teacher')
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = exam_records.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

-- 25. campus_visits: Staff can manage visits
DROP POLICY IF EXISTS "Staff can manage visits" ON public.campus_visits;
CREATE POLICY "Staff can manage visits" ON public.campus_visits
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        has_role(auth.uid(), 'campus_admin'::app_role)
        OR has_role(auth.uid(), 'admission_head'::app_role)
        OR has_role(auth.uid(), 'counsellor'::app_role)
      )
      AND public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

-- 26. lead_notes: Staff can manage lead notes
DROP POLICY IF EXISTS "Staff can manage lead notes" ON public.lead_notes;
CREATE POLICY "Staff can manage lead notes" ON public.lead_notes
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        has_role(auth.uid(), 'campus_admin'::app_role)
        OR has_role(auth.uid(), 'admission_head'::app_role)
        OR has_role(auth.uid(), 'counsellor'::app_role)
      )
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_notes.lead_id
          AND public.user_can_access_assigned_campus(auth.uid(), l.campus_id)
      )
    )
  );

-- 27. lead_followups: Staff can manage followups
DROP POLICY IF EXISTS "Staff can manage followups" ON public.lead_followups;
CREATE POLICY "Staff can manage followups" ON public.lead_followups
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        has_role(auth.uid(), 'campus_admin'::app_role)
        OR has_role(auth.uid(), 'admission_head'::app_role)
        OR has_role(auth.uid(), 'counsellor'::app_role)
      )
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_followups.lead_id
          AND public.user_can_access_assigned_campus(auth.uid(), l.campus_id)
      )
    )
  );

-- 28. applications: Staff view all applications
DROP POLICY IF EXISTS "Staff view all applications" ON public.applications;
CREATE POLICY "Staff view all applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::app_role)
        OR public.has_role(auth.uid(), 'principal'::app_role)
        OR public.has_role(auth.uid(), 'admission_head'::app_role)
        OR public.has_role(auth.uid(), 'counsellor'::app_role)
        OR public.has_role(auth.uid(), 'office_admin'::app_role)
        OR public.has_role(auth.uid(), 'accountant'::app_role)
        OR public.has_role(auth.uid(), 'data_entry'::app_role)
        OR public.has_role(auth.uid(), 'office_assistant'::app_role)
      )
      AND public.user_can_access_assigned_campus(
        auth.uid(),
        public.application_branch_campus_id(applications.lead_id, applications.course_selections)
      )
    )
  );

-- 29. applications: Staff update applications
DROP POLICY IF EXISTS "Staff update applications" ON public.applications;
CREATE POLICY "Staff update applications"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::app_role)
        OR public.has_role(auth.uid(), 'principal'::app_role)
        OR public.has_role(auth.uid(), 'admission_head'::app_role)
        OR public.has_role(auth.uid(), 'counsellor'::app_role)
        OR public.has_role(auth.uid(), 'office_admin'::app_role)
        OR public.has_role(auth.uid(), 'accountant'::app_role)
      )
      AND public.user_can_access_assigned_campus(
        auth.uid(),
        public.application_branch_campus_id(applications.lead_id, applications.course_selections)
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::app_role)
        OR public.has_role(auth.uid(), 'principal'::app_role)
        OR public.has_role(auth.uid(), 'admission_head'::app_role)
        OR public.has_role(auth.uid(), 'counsellor'::app_role)
        OR public.has_role(auth.uid(), 'office_admin'::app_role)
        OR public.has_role(auth.uid(), 'accountant'::app_role)
      )
      AND public.user_can_access_assigned_campus(
        auth.uid(),
        public.application_branch_campus_id(applications.lead_id, applications.course_selections)
      )
    )
  );
