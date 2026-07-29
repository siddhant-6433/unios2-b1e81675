-- Precise due dates for ALL school structures in session 2026-27 (Mirai + NIMT Beacon).
--   Q1 → 10 Apr 2026 · Q2 → 10 Jul 2026 · Q3 → 10 Oct 2026 · Q4 → 10 Jan 2027
--   Admission fee / Security deposit / Registration → at admission (session start, 01 Apr 2026)
--   Transport is modelled as quarterly (q1-q4), so it inherits the Q dates (per owner).
-- Sets the template (fee_structure_items.due_date) and re-syncs already-provisioned
-- ledgers. Due-date-only change, so the edit-lock trigger permits it; GUC set as a
-- deliberate-admin belt-and-suspenders.
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

-- Re-sync any already-provisioned ledgers for these students (school heads may have a
-- null fee_structure_item_id, so match by student course+session+term instead).
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
