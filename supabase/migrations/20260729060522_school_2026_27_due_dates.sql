-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260729060522 name=school_2026_27_due_dates applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

SET LOCAL app.allow_fee_structure_edit = 'on';

UPDATE public.fee_structure_items fsi
   SET due_date = CASE fsi.term
         WHEN 'q1' THEN DATE '2026-04-10'
         WHEN 'q2' THEN DATE '2026-07-10'
         WHEN 'q3' THEN DATE '2026-10-10'
         WHEN 'q4' THEN DATE '2027-01-10'
         WHEN 'admission'    THEN DATE '2026-04-01'
         WHEN 'registration' THEN DATE '2026-04-01'
         ELSE fsi.due_date END
  FROM public.fee_structures fs
 WHERE fs.id = fsi.fee_structure_id
   AND fs.session_id = 'f0000001-0000-0000-0000-000000000001'
   AND public.student_course_is_school(fs.course_id)
   AND fsi.term IN ('q1','q2','q3','q4','admission','registration');

UPDATE public.fee_ledger fl
   SET due_date = CASE fl.term
         WHEN 'q1' THEN DATE '2026-04-10'
         WHEN 'q2' THEN DATE '2026-07-10'
         WHEN 'q3' THEN DATE '2026-10-10'
         WHEN 'q4' THEN DATE '2027-01-10'
         WHEN 'admission'    THEN DATE '2026-04-01'
         WHEN 'registration' THEN DATE '2026-04-01'
         ELSE fl.due_date END,
       updated_at = now()
  FROM public.students s
 WHERE fl.student_id = s.id
   AND s.session_id = 'f0000001-0000-0000-0000-000000000001'
   AND public.student_course_is_school(s.course_id)
   AND fl.term IN ('q1','q2','q3','q4','admission','registration');
