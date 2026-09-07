-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260806120900 name=bsa_arthala_monthly_tuition_billing applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- NIMT School Arthala (BSA) — bill tuition MONTHLY instead of quarterly.

-- 1. structure: quarterly tuition -> 12 monthly items
DO $$
DECLARE
  r        record;
  v_year   int;
BEGIN
  FOR r IN
    SELECT fs.id AS fs_id, fs.session_id, ti.fee_code_id, ti.monthly
      FROM public.fee_structures fs
      JOIN public.courses c ON c.id = fs.course_id AND c.code LIKE 'BSA-%'
      JOIN LATERAL (
        SELECT fsi.fee_code_id, MAX(fsi.amount) / 3.0 AS monthly
          FROM public.fee_structure_items fsi
          JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id AND fc.category = 'tuition'
         WHERE fsi.fee_structure_id = fs.id
           AND fsi.term IN ('q1','q2','q3','q4')
         GROUP BY fsi.fee_code_id
      ) ti ON true
  LOOP
    SELECT COALESCE(EXTRACT(YEAR FROM start_date)::int, 2026) INTO v_year
      FROM public.admission_sessions WHERE id = r.session_id;
    v_year := COALESCE(v_year, 2026);

    DELETE FROM public.fee_structure_items
     WHERE fee_structure_id = r.fs_id
       AND fee_code_id = r.fee_code_id
       AND term IN ('q1','q2','q3','q4');

    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day, due_date)
    SELECT r.fs_id, r.fee_code_id, 'm_' || to_char(d, 'YYYY_MM'), r.monthly, 10, d
      FROM (
        SELECT (make_date(v_year, 4, 1) + (g || ' months')::interval)::date + 9 AS d
          FROM generate_series(0, 11) g
      ) months
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fee_structure_items x
       WHERE x.fee_structure_id = r.fs_id
         AND x.fee_code_id = r.fee_code_id
         AND x.term = 'm_' || to_char(d, 'YYYY_MM')
    );
  END LOOP;
END $$;

-- 2. re-provision existing BSA students (only those already provisioned)
DO $$
DECLARE
  st    record;
  v_fs  uuid;
BEGIN
  FOR st IN
    SELECT DISTINCT s.id, s.course_id, s.session_id, s.fee_structure_version
      FROM public.students s
      JOIN public.courses c ON c.id = s.course_id AND c.code LIKE 'BSA-%'
      JOIN public.fee_ledger fl ON fl.student_id = s.id
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id AND fc.category = 'tuition'
  LOOP
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

    DELETE FROM public.fee_ledger fl
     WHERE fl.student_id = st.id
       AND fl.paid_amount = 0
       AND fl.fee_code_id IN (SELECT id FROM public.fee_codes WHERE category = 'tuition');

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
