-- ====================================================================
-- NIMT School Arthala (BSA) — bill tuition MONTHLY instead of quarterly.
--
-- BSA tuition was seeded as four quarterly rows (q1..q4), each = monthly × 3,
-- all due on the 10th of the quarter's first month. Arthala now collects the
-- tuition month-by-month, so each month is its own charge due on the 10th.
--
-- Only the tuition head changes. BSA structures carry no other heads (no
-- admission fee), so nothing else is touched. Safe to run because no receipts
-- exist yet for any BSA student — we only ever delete UNPAID rows.
--
-- Two parts, atomic:
--   1. Rewrite each BSA fee_structure: drop the 4 quarterly tuition items,
--      insert 12 monthly items (term m_YYYY_MM, amount = quarterly/3, absolute
--      due_date = 10th of each month Apr..Mar). The provisioning edge function
--      already honours an item's absolute due_date first, so new admissions
--      auto-provision monthly with no code change.
--   2. Re-provision existing BSA students: delete their unpaid tuition ledger
--      rows and rebuild from the now-monthly structure, then re-run the
--      canonical concession sync.
-- ====================================================================

-- ────────── 1. structure: quarterly tuition → 12 monthly items ─────────
DO $$
DECLARE
  r        record;
  v_year   int;
BEGIN
  FOR r IN
    SELECT fs.id AS fs_id,
           fs.session_id,
           ti.fee_code_id,
           ti.monthly
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
    -- Academic year from the structure's session start (Apr-Mar); default 2026.
    SELECT COALESCE(EXTRACT(YEAR FROM start_date)::int, 2026) INTO v_year
      FROM public.admission_sessions WHERE id = r.session_id;
    v_year := COALESCE(v_year, 2026);

    DELETE FROM public.fee_structure_items
     WHERE fee_structure_id = r.fs_id
       AND fee_code_id = r.fee_code_id
       AND term IN ('q1','q2','q3','q4');

    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day, due_date)
    SELECT r.fs_id,
           r.fee_code_id,
           'm_' || to_char(d, 'YYYY_MM'),
           r.monthly,
           10,
           d
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

-- ────────── 2. re-provision existing BSA students ─────────────────────
DO $$
DECLARE
  st    record;
  v_fs  uuid;
BEGIN
  -- Only students who already have tuition ledger rows (i.e. were provisioned
  -- quarterly). Students not yet provisioned get monthly automatically when the
  -- admission trigger runs against the now-monthly structure.
  FOR st IN
    SELECT DISTINCT s.id, s.course_id, s.session_id, s.fee_structure_version
      FROM public.students s
      JOIN public.courses c ON c.id = s.course_id AND c.code LIKE 'BSA-%'
      JOIN public.fee_ledger fl ON fl.student_id = s.id
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id AND fc.category = 'tuition'
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

    -- Drop the old quarterly tuition rows (unpaid only — never touch money).
    DELETE FROM public.fee_ledger fl
     WHERE fl.student_id = st.id
       AND fl.paid_amount = 0
       AND fl.fee_code_id IN (SELECT id FROM public.fee_codes WHERE category = 'tuition');

    -- Rebuild monthly tuition from the structure, skipping any that survive.
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

    -- Re-derive any approved concessions / offer waivers onto the new rows.
    PERFORM public.sync_fee_ledger_concessions(st.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
