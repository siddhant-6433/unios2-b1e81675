-- DAOTT / DOTT Stetho Batch fee structure.
--
-- Source: WhatsApp fee card dated 2026-06-10.
-- Total cost: Rs 1,85,000 over 2.5 years / 5 semesters.
-- Keep the public/new-admission fee structure active while preserving legacy
-- ledgers through an explicit migration snapshot RPC.

DO $$
DECLARE
  v_session_id uuid := 'f0000001-0000-0000-0000-000000000001';
  v_course_id uuid;
  v_fs_id uuid;
  v_fc_seat uuid;
  v_fc_tuition uuid;
  v_fc_admin_tech uuid;
  v_fc_exam uuid;
BEGIN
  INSERT INTO public.fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'DAOTT-SEAT', 'DAOTT Seat Block Fee', 'enrollment', false)
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        category = EXCLUDED.category,
        is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_seat;

  IF v_fc_seat IS NULL THEN
    SELECT id INTO v_fc_seat FROM public.fee_codes WHERE code = 'DAOTT-SEAT';
  END IF;

  INSERT INTO public.fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'DAOTT-TUITION', 'DAOTT Tuition Fee', 'tuition', true)
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        category = EXCLUDED.category,
        is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_tuition;

  IF v_fc_tuition IS NULL THEN
    SELECT id INTO v_fc_tuition FROM public.fee_codes WHERE code = 'DAOTT-TUITION';
  END IF;

  INSERT INTO public.fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'DAOTT-ADMIN-TECH', 'DAOTT Admin & Technology Fee', 'other', true)
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        category = EXCLUDED.category,
        is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_admin_tech;

  IF v_fc_admin_tech IS NULL THEN
    SELECT id INTO v_fc_admin_tech FROM public.fee_codes WHERE code = 'DAOTT-ADMIN-TECH';
  END IF;

  INSERT INTO public.fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'DAOTT-EXAM', 'DAOTT Examination Fee', 'exam', true)
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        category = EXCLUDED.category,
        is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_exam;

  IF v_fc_exam IS NULL THEN
    SELECT id INTO v_fc_exam FROM public.fee_codes WHERE code = 'DAOTT-EXAM';
  END IF;

  FOR v_course_id IN
    SELECT id FROM public.courses WHERE code IN ('DAOTT-GN', 'OTT-GN')
  LOOP
    UPDATE public.courses
       SET type = 'semester',
           name = CASE
             WHEN code IN ('DAOTT-GN', 'OTT-GN') THEN 'Diploma of Anesthesia & OT Technology (D.AOTT)'
             ELSE name
           END
     WHERE id = v_course_id;

    -- Retire legacy active structures for new/pre-admission calculations.
    UPDATE public.fee_structures
       SET is_active = false
     WHERE course_id = v_course_id
       AND session_id = v_session_id
       AND version <> 'stetho_batch';

    INSERT INTO public.fee_structures (id, course_id, session_id, version, is_active, metadata)
    VALUES (
      gen_random_uuid(),
      v_course_id,
      v_session_id,
      'stetho_batch',
      true,
      jsonb_build_object(
        'plan_name', 'Stetho Batch',
        'display_name', 'Stetho Batch',
        'duration_label', '2.5 yrs · 5 semesters',
        'period_label', 'Semester',
        'period_label_plural', 'Semester-wise Breakdown',
        'period_fee_label', 'Semester Total',
        'total_fee', 185000,
        'source', 'WhatsApp fee card dated 2026-06-10',
        'year_1', jsonb_build_object('label', 'Sem 1', 'fee', 40000, 'payment_note', 'Seat block Rs 5,000 + tuition Rs 25,000 + admin & technology Rs 5,000 + examination Rs 5,000'),
        'year_2', jsonb_build_object('label', 'Sem 2', 'fee', 40000, 'payment_note', 'Tuition Rs 25,000 + admin & technology Rs 10,000 + examination Rs 5,000'),
        'year_3', jsonb_build_object('label', 'Sem 3', 'fee', 40000, 'payment_note', 'Tuition Rs 25,000 + admin & technology Rs 10,000 + examination Rs 5,000'),
        'year_4', jsonb_build_object('label', 'Sem 4', 'fee', 40000, 'payment_note', 'Tuition Rs 25,000 + admin & technology Rs 10,000 + examination Rs 5,000'),
        'year_5', jsonb_build_object('label', 'Sem 5', 'fee', 25000, 'payment_note', 'Tuition Rs 15,000 + admin & technology Rs 5,000 + examination Rs 5,000')
      )
    )
    ON CONFLICT (course_id, session_id, version) DO UPDATE
      SET is_active = true,
          metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;

    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;

    INSERT INTO public.fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_seat,       'year_1',  5000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition,    'year_1', 25000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_admin_tech, 'year_1',  5000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_exam,       'year_1',  5000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition,    'year_2', 25000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_admin_tech, 'year_2', 10000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_exam,       'year_2',  5000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition,    'year_3', 25000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_admin_tech, 'year_3', 10000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_exam,       'year_3',  5000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition,    'year_4', 25000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_admin_tech, 'year_4', 10000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_exam,       'year_4',  5000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition,    'year_5', 15000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_admin_tech, 'year_5',  5000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_exam,       'year_5',  5000, 10);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.fee_ledger_migration_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  from_version text,
  to_version text NOT NULL,
  reason text NOT NULL,
  old_ledger jsonb NOT NULL DEFAULT '[]',
  old_links jsonb NOT NULL DEFAULT '[]',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_migration_snapshots_student
  ON public.fee_ledger_migration_snapshots (student_id, created_at DESC);

ALTER TABLE public.fee_ledger_migration_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance staff read fee ledger migration snapshots"
  ON public.fee_ledger_migration_snapshots;
CREATE POLICY "Finance staff read fee ledger migration snapshots"
  ON public.fee_ledger_migration_snapshots FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head')
  );

GRANT SELECT ON public.fee_ledger_migration_snapshots TO authenticated;
GRANT ALL ON public.fee_ledger_migration_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.migrate_daott_student_to_stetho_batch(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_allowed boolean;
  v_student record;
  v_fs_id uuid;
  v_snapshot_id uuid;
  v_old_ledger jsonb;
  v_old_links jsonb;
  v_total_paid numeric := 0;
  v_total_concession numeric := 0;
  v_academic_year int := CASE WHEN EXTRACT(MONTH FROM current_date) >= 4 THEN EXTRACT(YEAR FROM current_date)::int ELSE EXTRACT(YEAR FROM current_date)::int - 1 END;
  v_item record;
  v_due_date date;
  v_paid numeric;
  v_concession numeric;
  v_net_due numeric;
  v_created int := 0;
BEGIN
  v_role_allowed :=
    auth.role() = 'service_role' OR
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head');

  IF NOT v_role_allowed THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT s.id, s.course_id, s.session_id, s.fee_structure_version, c.code AS course_code
    INTO v_student
    FROM public.students s
    JOIN public.courses c ON c.id = s.course_id
   WHERE s.id = _student_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF v_student.course_code NOT IN ('DAOTT-GN', 'OTT-GN') THEN
    RAISE EXCEPTION 'Student course is %, not DAOTT/DOTT', v_student.course_code;
  END IF;

  IF v_student.session_id IS NULL THEN
    RAISE EXCEPTION 'Student has no admission session';
  END IF;

  SELECT id INTO v_fs_id
    FROM public.fee_structures
   WHERE course_id = v_student.course_id
     AND session_id = v_student.session_id
     AND version = 'stetho_batch'
     AND is_active = true
   LIMIT 1;

  IF v_fs_id IS NULL THEN
    RAISE EXCEPTION 'No active Stetho Batch fee structure for this course/session';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(fl) ORDER BY fl.due_date, fl.term), '[]'::jsonb),
         COALESCE(SUM(fl.paid_amount), 0),
         COALESCE(SUM(fl.concession), 0)
    INTO v_old_ledger, v_total_paid, v_total_concession
    FROM public.fee_ledger fl
   WHERE fl.student_id = _student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(flp) ORDER BY flp.applied_at), '[]'::jsonb)
    INTO v_old_links
    FROM public.fee_ledger_payments flp
    JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
   WHERE fl.student_id = _student_id;

  INSERT INTO public.fee_ledger_migration_snapshots (
    student_id, from_version, to_version, reason, old_ledger, old_links, created_by
  ) VALUES (
    _student_id,
    v_student.fee_structure_version,
    'stetho_batch',
    'DAOTT/DOTT Stetho Batch migration',
    v_old_ledger,
    v_old_links,
    auth.uid()
  )
  RETURNING id INTO v_snapshot_id;

  DELETE FROM public.fee_ledger WHERE student_id = _student_id;

  UPDATE public.students
     SET fee_structure_version = 'stetho_batch',
         updated_at = now()
   WHERE id = _student_id;

  FOR v_item IN
    SELECT fsi.id, fsi.fee_code_id, fsi.term, fsi.amount, fsi.due_day, fc.category, fc.code
      FROM public.fee_structure_items fsi
      JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
     WHERE fsi.fee_structure_id = v_fs_id
     ORDER BY fsi.term, CASE fc.category
       WHEN 'enrollment' THEN 1
       WHEN 'tuition' THEN 2
       WHEN 'other' THEN 3
       WHEN 'exam' THEN 4
       ELSE 9
     END, fc.code
  LOOP
    v_due_date := CASE v_item.term
      WHEN 'year_1' THEN make_date(v_academic_year, 4, LEAST(GREATEST(COALESCE(v_item.due_day, 10), 1), 28))
      WHEN 'year_2' THEN make_date(v_academic_year, 10, LEAST(GREATEST(COALESCE(v_item.due_day, 10), 1), 28))
      WHEN 'year_3' THEN make_date(v_academic_year + 1, 4, LEAST(GREATEST(COALESCE(v_item.due_day, 10), 1), 28))
      WHEN 'year_4' THEN make_date(v_academic_year + 1, 10, LEAST(GREATEST(COALESCE(v_item.due_day, 10), 1), 28))
      WHEN 'year_5' THEN make_date(v_academic_year + 2, 4, LEAST(GREATEST(COALESCE(v_item.due_day, 10), 1), 28))
      ELSE current_date
    END;

    v_concession := LEAST(v_total_concession, v_item.amount);
    v_total_concession := GREATEST(v_total_concession - v_concession, 0);
    v_net_due := GREATEST(v_item.amount - v_concession, 0);
    v_paid := LEAST(v_total_paid, v_net_due);
    v_total_paid := GREATEST(v_total_paid - v_paid, 0);

    INSERT INTO public.fee_ledger (
      student_id, fee_code_id, fee_structure_item_id, term, total_amount,
      concession, paid_amount, due_date, status
    ) VALUES (
      _student_id,
      v_item.fee_code_id,
      v_item.id,
      v_item.term,
      v_item.amount,
      v_concession,
      v_paid,
      v_due_date,
      CASE WHEN v_paid >= v_net_due THEN 'paid' ELSE 'due' END
    );

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'student_id', _student_id,
    'from_version', v_student.fee_structure_version,
    'to_version', 'stetho_batch',
    'ledger_rows_created', v_created,
    'unallocated_paid_amount', v_total_paid,
    'unallocated_concession_amount', v_total_concession
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.migrate_daott_student_to_stetho_batch(uuid)
  TO authenticated, service_role;
