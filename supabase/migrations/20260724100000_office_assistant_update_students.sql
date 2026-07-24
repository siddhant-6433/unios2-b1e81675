-- office_assistant is offered the "Correct Information" action in the student
-- profile UI (canCorrectProfile) and the contact-change flow, but the students
-- UPDATE policy did not include it. RLS silently filtered the row out, so edits
-- reported success and logged audit entries while never persisting.
-- Grant office_assistant the same broad update access as the other office/staff
-- roles already in this policy.
DROP POLICY IF EXISTS "Staff can update students" ON public.students;
CREATE POLICY "Staff can update students" ON public.students
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'data_entry'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'data_entry'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
  );
