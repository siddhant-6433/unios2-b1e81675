-- keep-migration-version: already recorded on production schema_migrations
-- ABVMU Enrollment & Roll No Fee was seeded as 130 orphan ledger rows (no
-- fee_structure_item). Make it a real template item on the BPT / BMRIT / B.Sc
-- Nursing structures, link the existing rows, and give the students it missed.
-- Idempotent.
DO $$
DECLARE
  v_code uuid; v_struct record; v_item uuid;
BEGIN
  SELECT id INTO v_code FROM public.fee_codes WHERE code = 'ABVMU-ENROLL';
  IF v_code IS NULL THEN RETURN; END IF;

  FOR v_struct IN
    SELECT fs.id, fs.course_id, fs.session_id
      FROM public.fee_structures fs
     WHERE fs.is_active
       AND fs.id IN ('5f533fc2-1896-4827-96a7-299d18f5db79',   -- BMRIT
                     '0f626a9e-0687-4d01-855b-30b45275323b',   -- BPT
                     '1073c853-c83e-479b-9639-0fef82b01074')   -- B.Sc Nursing
  LOOP
    SELECT id INTO v_item FROM public.fee_structure_items
     WHERE fee_structure_id = v_struct.id AND fee_code_id = v_code AND term = 'adhoc';
    IF v_item IS NULL THEN
      INSERT INTO public.fee_structure_items
        (fee_structure_id, fee_code_id, term, amount, due_day, due_date)
      VALUES (v_struct.id, v_code, 'adhoc', 1000, 19, DATE '2026-10-19')
      RETURNING id INTO v_item;
    END IF;

    -- link the orphan rows seeded on 2026-10-16
    UPDATE public.fee_ledger fl SET fee_structure_item_id = v_item
      FROM public.students s
     WHERE fl.student_id = s.id AND s.course_id = v_struct.course_id
       AND fl.fee_code_id = v_code AND fl.fee_structure_item_id IS NULL;

    -- students the one-off script missed (incl. null session_id)
    INSERT INTO public.fee_ledger
      (student_id, fee_code_id, fee_structure_item_id, term, total_amount, due_date, status)
    SELECT s.id, v_code, v_item, 'adhoc', 1000, DATE '2026-10-19', 'due'
      FROM public.students s
     WHERE s.course_id = v_struct.course_id
       AND (s.session_id = v_struct.session_id OR s.session_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.fee_ledger x
                        WHERE x.student_id = s.id AND x.fee_code_id = v_code);
  END LOOP;
END $$;
