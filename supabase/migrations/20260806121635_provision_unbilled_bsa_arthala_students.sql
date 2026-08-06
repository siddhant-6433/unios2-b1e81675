-- Provision monthly tuition for ACTIVE Arthala (GZ1 / BSA) students who were
-- never billed at all — the admission trigger never fired for them, so they had
-- no fee_ledger tuition rows. The BSA structures are already monthly (see
-- 20260806…_bsa_arthala_monthly_tuition_billing), so this simply materialises
-- each student's 12 monthly rows from their matched structure.
--
-- Insert-only and idempotent: a student who already has tuition rows is skipped
-- (the loop only picks up those with none), and each insert is dup-guarded.
-- Inactive students are intentionally left unbilled.

DO $$
DECLARE
  st    record;
  v_fs  uuid;
BEGIN
  FOR st IN
    SELECT s.id, s.course_id, s.session_id, s.fee_structure_version
      FROM public.students s
      JOIN public.campuses cam ON cam.id = s.campus_id AND cam.code = 'GZ1'
     WHERE s.status = 'active'
       AND s.course_id IS NOT NULL
       AND s.session_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.fee_ledger fl
         JOIN public.fee_codes fc ON fc.id = fl.fee_code_id AND fc.category = 'tuition'
         WHERE fl.student_id = s.id
       )
  LOOP
    -- Match the student's structure: exact version, else 'standard', else any active.
    SELECT fs.id INTO v_fs
      FROM public.fee_structures fs
     WHERE fs.course_id = st.course_id
       AND fs.session_id = st.session_id
       AND fs.is_active
     ORDER BY (fs.version = COALESCE(st.fee_structure_version, '')) DESC,
              (fs.version = 'standard') DESC,
              fs.created_at
     LIMIT 1;
    IF v_fs IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    SELECT st.id, fsi.fee_code_id, fsi.term, fsi.amount, fsi.due_date, 'due'
      FROM public.fee_structure_items fsi
      JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id AND fc.category = 'tuition'
     WHERE fsi.fee_structure_id = v_fs
       AND NOT EXISTS (
         SELECT 1 FROM public.fee_ledger fl2
          WHERE fl2.student_id = st.id
            AND fl2.fee_code_id = fsi.fee_code_id
            AND fl2.term = fsi.term
       );

    PERFORM public.sync_fee_ledger_concessions(st.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
