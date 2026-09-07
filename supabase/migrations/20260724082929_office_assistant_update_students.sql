-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260724082929 name=office_assistant_update_students applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
