-- Populate NB-DBA (Day Boarding) fee for all Beacon Avantika grades
-- Rate: ₹4,000/month (includes after-school lunch meal)
-- Quarterly: ₹4,000 × 3 = ₹12,000

DO $$
DECLARE
  v_fc_dba uuid;
  v_fs record;
BEGIN
  SELECT id INTO v_fc_dba FROM fee_codes WHERE code = 'NB-DBA';
  IF v_fc_dba IS NULL THEN
    RAISE EXCEPTION 'NB-DBA fee code not found — run schema migration first';
  END IF;

  -- For every active Beacon Avantika fee structure (both new_admission and existing_parent)
  FOR v_fs IN
    SELECT fs.id
    FROM fee_structures fs
    JOIN courses c ON c.id = fs.course_id
    WHERE c.code LIKE 'BSAV-%' AND fs.is_active = true
  LOOP
    -- Insert quarterly NB-DBA items
    FOR q IN 1..4 LOOP
      INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
      VALUES (v_fs.id, v_fc_dba, 'q' || q, 4000 * 3, 10)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
