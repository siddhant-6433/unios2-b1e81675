-- keep-migration-version: already recorded on production schema_migrations.
-- preserve application fee link repair audits
-- Repair snapshots are accounting evidence and must survive student deletion.
ALTER TABLE public.application_fee_duplicate_link_repairs
  DROP CONSTRAINT IF EXISTS application_fee_duplicate_link_repairs_student_id_fkey;

ALTER TABLE public.application_fee_duplicate_link_repairs
  ADD CONSTRAINT application_fee_duplicate_link_repairs_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;
