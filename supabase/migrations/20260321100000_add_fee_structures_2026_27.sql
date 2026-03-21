-- Fee structures for NIMT 2026-27 academic year
-- Source: FEE STRUCTURE 2026-2027 Excel sheet

ALTER TABLE public.fee_structures ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
DECLARE
  v_session_id UUID;
  v_tuition_id UUID;
  v_fs_id UUID;
  v_course_id UUID;
BEGIN
  -- Get or create 2026-27 session
  SELECT id INTO v_session_id FROM public.admission_sessions
    WHERE name ILIKE '%2026%' OR name ILIKE '%2025-26%'
    ORDER BY is_active DESC, created_at DESC LIMIT 1;
  IF v_session_id IS NULL THEN
    INSERT INTO public.admission_sessions (name, start_date, end_date, is_active)
    VALUES ('2025-26', '2025-07-01', '2026-06-30', true)
    RETURNING id INTO v_session_id;
  END IF;

  -- Ensure base fee code exists
  INSERT INTO public.fee_codes (code, name, category, is_recurring)
  VALUES ('ANNUAL_TUITION', 'Annual Tuition Fee', 'tuition', true)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_tuition_id FROM public.fee_codes WHERE code = 'ANNUAL_TUITION';

  -- ─── HELPER: for each plan we INSERT fee_structure then DELETE+INSERT items ───

  -- ══════════════════════════════════════════════════════════════
  -- NURSING: B.Sc Nursing
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%B.Sc%Nurs%' OR name ILIKE '%Bachelor%Science%Nurs%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    -- 26-BSN-6 (EMI 6 installments)
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BSN-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',8000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt, One Scrub Top, One Scrub Bottom, One Underscrub, One Lab Coat (11 items)',
      'seat_reservation_deposit',40000,'total_fee',627032,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU Theory Exam/Migration/Degree/Certificate/Marksheet/Enrollment charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',148225,'installment',19371,'installment_count',6,'payment_note','40000 ABVMUP Deposit + 116225 in 6 EMIs','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',154601,'installment',25767,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',159553,'installment',26592,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_4',jsonb_build_object('fee',164654,'installment',27442,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 148225, 10),
      (v_fs_id, v_tuition_id, 'year_2', 154601, 10),
      (v_fs_id, v_tuition_id, 'year_3', 159553, 10),
      (v_fs_id, v_tuition_id, 'year_4', 164654, 10);

    -- 26-BSN-BI (Standard Installment)
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BSN-BI', true, jsonb_build_object(
      'plan_name','Standard Installment Fee Option','form_fee',1000,'uniform_cost',8000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt, One Scrub Top, One Scrub Bottom, One Underscrub, One Lab Coat (11 items)',
      'seat_reservation_deposit',40000,'total_fee',640095,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU Theory Exam/Migration/Degree/Certificate/Marksheet/Enrollment charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',153000,'installment',78795,'installment_count',2,'payment_note','40000 ABVMUP Deposit + 60500 by 10 Jun 2026 + 60500 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',157590,'installment',78795,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',162318,'installment',81159,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028'),
      'year_4',jsonb_build_object('fee',167187,'installment',83594,'installment_count',2,'payment_note','10 Jul 2029 + 10 Jan 2030','discount',10000,'discount_condition','Full fee on or before 10 Jul 2029')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 153000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 157590, 10),
      (v_fs_id, v_tuition_id, 'year_3', 162318, 10),
      (v_fs_id, v_tuition_id, 'year_4', 167187, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- NURSING: GNM
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%General Nursing%' OR name ILIKE '%GNM%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-GNM-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',8000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt, One Scrub Top, One Scrub Bottom, One Underscrub, One Lab Coat (11 items)',
      'seat_reservation_deposit',5000,'total_fee',350721,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF Theory Exam/Migration/Degree/Certificate/Marksheet/UPSMF registration charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',113225,'installment',19371,'installment_count',6,'payment_note','5000 Seat Deposit + 116225 in 6 EMIs of 19371','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',116838,'installment',19473,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',120658,'installment',20110,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 113225, 10),
      (v_fs_id, v_tuition_id, 'year_2', 116838, 10),
      (v_fs_id, v_tuition_id, 'year_3', 120658, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-GNM-BI', true, jsonb_build_object(
      'plan_name','Standard Installment Fee Option','form_fee',1000,'uniform_cost',8000,
      'seat_reservation_deposit',5000,'total_fee',364726,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',118000,'installment',60770,'installment_count',2,'payment_note','5000 deposit + 70000+8000 by 10 Jun 2026 + 43000 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',121540,'installment',60770,'installment_count',2,'payment_note','10 Jul 2026 + 10 Jan 2027','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',125186,'installment',62593,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 118000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 121540, 10),
      (v_fs_id, v_tuition_id, 'year_3', 125186, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MEDICAL: BMRIT
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%BMRIT%' OR (name ILIKE '%Radiology%' AND name ILIKE '%B.Sc%') LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BMR-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',40000,'total_fee',264878,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU Theory Exam/Migration/Degree/Certificate/Marksheet/Enrollment charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',84328,'installment',8388,'installment_count',6,'payment_note','40000 ABVMUP Deposit + 50328 in 6 EMIs of 8388','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',88786,'installment',14798,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',91764,'installment',15294,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 84328, 10),
      (v_fs_id, v_tuition_id, 'year_2', 88786, 10),
      (v_fs_id, v_tuition_id, 'year_3', 91764, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BMR-BI', true, jsonb_build_object(
      'plan_name','Standard Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',40000,'total_fee',284363,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',92000,'installment',47380,'installment_count',2,'payment_note','40000 ABVMUP Deposit + 31000 fee+uniform by 10 Jun 2026 + 27000 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',94760,'installment',47380,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',97603,'installment',48801,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 92000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 94760, 10),
      (v_fs_id, v_tuition_id, 'year_3', 97603, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MEDICAL: DPT (Diploma in Physiotherapy)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%Diploma%Physiotherapy%' OR name ILIKE '%DPT%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-DPT-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',20000,'total_fee',112366,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',54900,'installment',6817,'installment_count',6,'payment_note','20000 Seat Deposit + 40900 in 6 EMIs of 6817','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',57466,'installment',9578,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 54900, 10),
      (v_fs_id, v_tuition_id, 'year_2', 57466, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-DPT-BI', true, jsonb_build_object(
      'plan_name','Standard Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',20000,'total_fee',125860,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',62000,'installment',31000,'installment_count',2,'payment_note','20000 deposit + 24000 by 10 Jun 2026 + 24000 by 10 Jan 2027','discount',9000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',63860,'installment',31930,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',9000,'discount_condition','Full fee on or before 10 Jul 2027')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 62000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 63860, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MEDICAL: BPT (Bachelor of Physiotherapy)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%Bachelor%Physiotherapy%' OR name ILIKE '%BPT%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BPT-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',40000,'total_fee',359709,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',84328,'installment',7388,'installment_count',6,'payment_note','40000 ABVMUP Deposit + 50328 in 6 EMIs','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',88786,'installment',14798,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',91764,'installment',15294,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_4',jsonb_build_object('fee',94831,'installment',15805,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 84328, 10),
      (v_fs_id, v_tuition_id, 'year_2', 88786, 10),
      (v_fs_id, v_tuition_id, 'year_3', 91764, 10),
      (v_fs_id, v_tuition_id, 'year_4', 94831, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BPT-BI', true, jsonb_build_object(
      'plan_name','Standard Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',40000,'total_fee',384894,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',92000,'installment',47380,'installment_count',2,'payment_note','40000 ABVMUP Deposit + 31000 fee+uniform by 10 Jun 2026 + 27000 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',94760,'installment',47380,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',97603,'installment',48801,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028'),
      'year_4',jsonb_build_object('fee',100531,'installment',50265,'installment_count',2,'payment_note','10 Jul 2029 + 10 Jan 2030','discount',10000,'discount_condition','Full fee on or before 10 Jul 2029')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 92000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 94760, 10),
      (v_fs_id, v_tuition_id, 'year_3', 97603, 10),
      (v_fs_id, v_tuition_id, 'year_4', 100531, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MEDICAL: OTT (Diploma in Operation Theater Technician)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%Operation Theater%' OR name ILIKE '%OTT%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-OTT-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',20000,'total_fee',112366,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',54900,'installment',6817,'installment_count',6,'payment_note','20000 Seat Deposit + 40900 in 6 EMIs of 6817','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',57466,'installment',9578,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 54900, 10),
      (v_fs_id, v_tuition_id, 'year_2', 57466, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-OTT-BI', true, jsonb_build_object(
      'plan_name','Standard Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',20000,'total_fee',125860,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',62000,'installment',31000,'installment_count',2,'payment_note','20000 deposit + 24000 by 10 Jun 2026 + 24000 by 10 Jan 2027','discount',9000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',63860,'installment',31930,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',9000,'discount_condition','Full fee on or before 10 Jul 2027')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 62000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 63860, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- EDUCATION: B.Ed Greater Noida
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE (name ILIKE '%B.Ed%' OR name ILIKE '%Bachelor%Education%')
      AND EXISTS (
        SELECT 1 FROM public.departments d
          JOIN public.institutions i ON i.id = d.institution_id
          JOIN public.campuses c ON c.id = i.campus_id
        WHERE d.id = courses.department_id AND c.name ILIKE '%Greater Noida%'
      )
    LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-BEDGN-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',0,'uniform_cost',0,
      'uniform_description','No Uniform. Only Dress Code.',
      'seat_reservation_deposit',15000,'total_fee',85183,
      'fee_exclusions','CCSU Theory Exam/Migration/Degree/Certificate/Marksheet/CCSU registration charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',53758,'installment',6460,'installment_count',6,'payment_note','15000 Seat Deposit + 38758 in 6 EMIs of 6460','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',31425,'installment',5238,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 53758, 10),
      (v_fs_id, v_tuition_id, 'year_2', 31425, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-BEDGN-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option (UPBED Direct Counselling)','form_fee',0,'uniform_cost',0,
      'seat_reservation_deposit',15000,'total_fee',88000,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',56000,'installment',28000,'installment_count',2,'payment_note','15000 deposit + 13000 by 10 Jun 2025 + 28000 by 10 Jan 2026','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',32000,'installment',16000,'installment_count',2,'payment_note','10 Jul 2026 + 10 Jan 2027','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 56000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 32000, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-BEDGN-FL', true, jsonb_build_object(
      'plan_name','Discounted Fee Option','form_fee',0,'uniform_cost',0,
      'seat_reservation_deposit',0,'total_fee',82000,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',52000,'installment',52000,'installment_count',1,'payment_note','52000 on UPBED Portal or College Portal (Direct Round)','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',30000,'installment',30000,'installment_count',1,'payment_note','10 Jul 2026','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 52000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 30000, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- EDUCATION: D.El.Ed (Ghaziabad)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%D.El.Ed%' OR name ILIKE '%Diploma%Elementary%' OR name ILIKE '%BTC%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-DLD-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',0,'uniform_cost',0,
      'uniform_description','No Uniform. Only Dress Code.',
      'seat_reservation_deposit',15000,'total_fee',85183,
      'fee_exclusions','DIET Theory Exam/Migration/Degree/Certificate/Marksheet/DIET registration charges payable directly to DIET',
      'year_1',jsonb_build_object('fee',42235,'installment',4539,'installment_count',6,'payment_note','15000 Seat Deposit (incl 10000 UPDELED Reg) + 27235 in 6 EMIs of 4539','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',42948,'installment',7158,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 42235, 10),
      (v_fs_id, v_tuition_id, 'year_2', 42948, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-DLD-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',0,'uniform_cost',0,
      'seat_reservation_deposit',15000,'total_fee',90000,
      'fee_exclusions','DIET charges payable directly to DIET',
      'year_1',jsonb_build_object('fee',45000,'installment',22500,'installment_count',2,'payment_note','15000 deposit (incl 10000 UPDELED) + 30000 by 10 Jun 2025 + 12500 by 10 Jan 2026','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',45000,'installment',22500,'installment_count',2,'payment_note','10 Jul 2026 + 10 Jan 2027','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 45000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 45000, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-DLD-FL', true, jsonb_build_object(
      'plan_name','Discounted Fee Option','form_fee',0,'uniform_cost',0,
      'seat_reservation_deposit',15000,'total_fee',82000,
      'fee_exclusions','DIET charges payable directly to DIET',
      'year_1',jsonb_build_object('fee',41000,'installment',41000,'installment_count',1,'payment_note','15000 deposit (incl 10000 UPDELED) + 26000 by 10 Jun 2025','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',41000,'installment',41000,'installment_count',1,'payment_note','10 Jul 2026','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 41000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 41000, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- EDUCATION: B.Ed Ghaziabad
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE (name ILIKE '%B.Ed%' OR name ILIKE '%Bachelor%Education%')
      AND EXISTS (
        SELECT 1 FROM public.departments d
          JOIN public.institutions i ON i.id = d.institution_id
          JOIN public.campuses c ON c.id = i.campus_id
        WHERE d.id = courses.department_id AND (c.name ILIKE '%Ghaziabad%' OR c.name ILIKE '%Avantika%')
      )
    LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-BEDGZ-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',0,'uniform_cost',0,
      'uniform_description','No Uniform. Only Dress Code.',
      'seat_reservation_deposit',15000,'total_fee',85183,
      'fee_exclusions','CCSU Theory Exam/Migration/Degree/Certificate/Marksheet/CCSU registration charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',53758,'installment',6460,'installment_count',6,'payment_note','15000 Seat Deposit + 38758 in 6 EMIs of 6460','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',31425,'installment',5238,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 53758, 10),
      (v_fs_id, v_tuition_id, 'year_2', 31425, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-BEDGZ-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option (UPBED Direct Counselling)','form_fee',0,'uniform_cost',0,
      'seat_reservation_deposit',15000,'total_fee',88000,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',56000,'installment',28000,'installment_count',2,'payment_note','15000 deposit + 13000 by 10 Jun 2025 + 28000 by 10 Jan 2026','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',32000,'installment',16000,'installment_count',2,'payment_note','10 Jul 2026 + 10 Jan 2027','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 56000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 32000, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-BEDGZ-FL', true, jsonb_build_object(
      'plan_name','Discounted Fee Option','form_fee',0,'uniform_cost',0,
      'seat_reservation_deposit',0,'total_fee',82000,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',52000,'installment',52000,'installment_count',1,'payment_note','52000 on UPBED Portal or College Portal','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',30000,'installment',30000,'installment_count',1,'payment_note','10 Jul 2026','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 52000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 30000, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- EDUCATION: B.Ed Kotputli
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE (name ILIKE '%B.Ed%' OR name ILIKE '%Bachelor%Education%')
      AND EXISTS (
        SELECT 1 FROM public.departments d
          JOIN public.institutions i ON i.id = d.institution_id
          JOIN public.campuses c ON c.id = i.campus_id
        WHERE d.id = courses.department_id AND c.name ILIKE '%Kotputli%'
      )
    LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '25-BEDKT-FL', true, jsonb_build_object(
      'plan_name','Discounted Fee Option','form_fee',0,'uniform_cost',0,
      'uniform_description','No Uniform. Only Dress Code.',
      'seat_reservation_deposit',0,'total_fee',54000,
      'fee_exclusions','RU Theory Exam/Migration/Degree/Certificate/Marksheet/RU registration charges payable directly to RU',
      'year_1',jsonb_build_object('fee',27000,'installment',27000,'installment_count',1,'payment_note','27000 on PTET Portal','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',27000,'installment',27000,'installment_count',1,'payment_note','10 Jul 2026','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 27000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 27000, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- COMPUTER SCIENCE: BCA
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%BCA%' OR name ILIKE '%Bachelor%Computer%Application%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BCA-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',20000,'total_fee',237415,
      'fee_exclusions','CCSU Theory Exam/Migration/Degree/Certificate/Marksheet/CCSU registration charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',72375,'installment',9729,'installment_count',6,'payment_note','20000 Seat Deposit + 58375 in 6 EMIs of 9729','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',75682,'installment',12614,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',78109,'installment',13018,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 72375, 10),
      (v_fs_id, v_tuition_id, 'year_2', 75682, 10),
      (v_fs_id, v_tuition_id, 'year_3', 78109, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BCA-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',20000,'total_fee',231818,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',75000,'installment',37500,'installment_count',2,'payment_note','20000 deposit + 30500 by 10 Jun 2026 + 30500 by 10 Jan 2027','discount',5000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',77250,'installment',38625,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',5000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',79568,'installment',39784,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',5000,'discount_condition','Full fee on or before 10 Jul 2028')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 75000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 77250, 10),
      (v_fs_id, v_tuition_id, 'year_3', 79568, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MANAGEMENT: BBA
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%BBA%' OR name ILIKE '%Bachelor%Business%Administration%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BBA-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',20000,'total_fee',237415,
      'fee_exclusions','CCSU Theory Exam/Migration/Degree/Certificate/Marksheet/CCSU registration charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',72375,'installment',9729,'installment_count',6,'payment_note','20000 Seat Deposit + 58375 in 6 EMIs of 9729','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',75682,'installment',12614,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',78109,'installment',13018,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 72375, 10),
      (v_fs_id, v_tuition_id, 'year_2', 75682, 10),
      (v_fs_id, v_tuition_id, 'year_3', 78109, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-BBA-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',20000,'total_fee',231818,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',75000,'installment',37500,'installment_count',2,'payment_note','20000 deposit + 30500 by 10 Jun 2026 + 30500 by 10 Jan 2027','discount',5000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',77250,'installment',38625,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',5000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',79568,'installment',39784,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',5000,'discount_condition','Full fee on or before 10 Jul 2028')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 75000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 77250, 10),
      (v_fs_id, v_tuition_id, 'year_3', 79568, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MANAGEMENT: MBA (Greater Noida)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%MBA%' OR name ILIKE '%Master%Business%Administration%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-MBA-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1500,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',25000,'total_fee',267071,
      'fee_exclusions','AKTU Theory Exam/Migration/Degree/Certificate/Marksheet/AKTU registration charges payable directly to AKTU',
      'year_1',jsonb_build_object('fee',124513,'installment',17585,'installment_count',6,'payment_note','25000 Seat Deposit + 105513 in 6 EMIs of 17585','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',129785,'installment',21631,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 124513, 10),
      (v_fs_id, v_tuition_id, 'year_2', 129785, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-MBA-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',1500,'uniform_cost',6000,
      'seat_reservation_deposit',25000,'total_fee',263900,
      'fee_exclusions','AKTU charges payable directly to AKTU',
      'year_1',jsonb_build_object('fee',130000,'installment',65000,'installment_count',2,'payment_note','25000 deposit + 55500 by 31 May 2026 + 55500 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',133900,'installment',66950,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 130000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 133900, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MANAGEMENT: PGDM Greater Noida
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE (name ILIKE '%PGDM%' OR name ILIKE '%Post Graduate Diploma%Management%')
      AND EXISTS (
        SELECT 1 FROM public.departments d
          JOIN public.institutions i ON i.id = d.institution_id
          JOIN public.campuses c ON c.id = i.campus_id
        WHERE d.id = courses.department_id AND c.name ILIKE '%Greater Noida%'
      )
    LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-PGDGN-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1500,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',25000,'total_fee',456341,
      'year_1',jsonb_build_object('fee',213550,'installment',32425,'installment_count',6,'payment_note','25000 Seat Deposit + 194550 in 6 EMIs of 32425','discount',20000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',221808,'installment',36968,'installment_count',6,'payment_note','6 EMIs','discount',20000,'discount_condition','Full fee on or before 10 Jul 2027')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 213550, 10),
      (v_fs_id, v_tuition_id, 'year_2', 221808, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-PGDGN-TRI', true, jsonb_build_object(
      'plan_name','Installment Fee Option (Trimester)','form_fee',1500,'uniform_cost',6000,
      'seat_reservation_deposit',25000,'total_fee',456750,
      'year_1',jsonb_build_object('fee',225000,'installment',75000,'installment_count',3,'payment_note','25000 deposit + 56000 by 31 May 2026 + 75000 by 30 Sep 2026 + 75000 by 10 Jan 2027','discount',20000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',231750,'installment',115875,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',20000,'discount_condition','Full fee on or before 10 Jul 2027')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 225000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 231750, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- MANAGEMENT: PGDM Kotputli
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE (name ILIKE '%PGDM%' OR name ILIKE '%Post Graduate Diploma%Management%')
      AND EXISTS (
        SELECT 1 FROM public.departments d
          JOIN public.institutions i ON i.id = d.institution_id
          JOIN public.campuses c ON c.id = i.campus_id
        WHERE d.id = courses.department_id AND c.name ILIKE '%Kotputli%'
      )
    LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-PGDKT-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',25000,'total_fee',435358,
      'year_1',jsonb_build_object('fee',213550,'installment',32425,'installment_count',6,'payment_note','25000 Seat Deposit + 194550 in 6 EMIs of 32425','discount',20000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',221808,'installment',36968,'installment_count',6,'payment_note','6 EMIs','discount',20000,'discount_condition','Full fee on or before 10 Jul 2027')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 213550, 10),
      (v_fs_id, v_tuition_id, 'year_2', 221808, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-PGDKT-TRI', true, jsonb_build_object(
      'plan_name','Installment Fee Option (Trimester)','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',25000,'total_fee',456750,
      'year_1',jsonb_build_object('fee',225000,'installment',75000,'installment_count',3,'payment_note','25000 deposit + 56000 by 31 May 2026 + 75000 by 30 Sep 2026 + 75000 by 10 Jan 2027','discount',20000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',231750,'installment',115875,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',20000,'discount_condition','Full fee on or before 10 Jul 2027')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 225000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 231750, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- PHARMACY: D.Pharma
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%D.Pharma%' OR name ILIKE '%Diploma%Pharmacy%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-DPM-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',15000,'total_fee',188942,
      'fee_exclusions','BTE Theory Exam/Migration/Degree/Certificate/Marksheet/BTE registration charges payable directly to BTE',
      'year_1',jsonb_build_object('fee',88325,'installment',12221,'installment_count',6,'payment_note','15000 Seat Deposit + 73325 in 6 EMIs of 12221','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',91709,'installment',15285,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 88325, 10),
      (v_fs_id, v_tuition_id, 'year_2', 91709, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-DPM-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',15000,'total_fee',192850,
      'fee_exclusions','BTE charges payable directly to BTE',
      'year_1',jsonb_build_object('fee',95000,'installment',47500,'installment_count',2,'payment_note','15000 deposit + 32500 by 10 Jun 2026 + 47500 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',97850,'installment',48925,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 95000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 97850, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- LAW: BALLB (Greater Noida, 5-year)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%BALLB%' OR name ILIKE '%BA%LLB%' OR name ILIKE '%Bachelor%Arts%Laws%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-LLB5-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',6000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt (7 items)',
      'seat_reservation_deposit',25000,'total_fee',558183,
      'fee_exclusions','CCSU Theory Exam/Migration/Degree/Certificate/Marksheet/CCSU registration charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',103563,'installment',14094,'installment_count',6,'payment_note','25000 Seat Deposit + 84563 in 6 EMIs of 14094','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',108207,'installment',18034,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',111767,'installment',18628,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_4',jsonb_build_object('fee',115434,'installment',19239,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_5',jsonb_build_object('fee',119212,'installment',19869,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 103563, 10),
      (v_fs_id, v_tuition_id, 'year_2', 108207, 10),
      (v_fs_id, v_tuition_id, 'year_3', 111767, 10),
      (v_fs_id, v_tuition_id, 'year_4', 115434, 10),
      (v_fs_id, v_tuition_id, 'year_5', 119212, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-LLB5-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',25000,'total_fee',584005,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',110000,'installment',55000,'installment_count',2,'payment_note','25000 deposit + 45500 by 10 Jun 2026 + 45500 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',113300,'installment',56650,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',116699,'installment',58350,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028'),
      'year_4',jsonb_build_object('fee',120200,'installment',60100,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2029'),
      'year_5',jsonb_build_object('fee',123806,'installment',61903,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2030')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 110000, 10),
      (v_fs_id, v_tuition_id, 'year_2', 113300, 10),
      (v_fs_id, v_tuition_id, 'year_3', 116699, 10),
      (v_fs_id, v_tuition_id, 'year_4', 120200, 10),
      (v_fs_id, v_tuition_id, 'year_5', 123806, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- LAW: LLB Kotputli (3-year)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE (name ILIKE '%LLB%' OR name ILIKE '%Bachelor%Laws%')
      AND NOT (name ILIKE '%BA%' OR name ILIKE '%Arts%')
      AND EXISTS (
        SELECT 1 FROM public.departments d
          JOIN public.institutions i ON i.id = d.institution_id
          JOIN public.campuses c ON c.id = i.campus_id
        WHERE d.id = courses.department_id AND c.name ILIKE '%Kotputli%'
      )
    LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-LLB3-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',0,
      'uniform_description','No Uniform. Only Dress Code.',
      'seat_reservation_deposit',22125,'total_fee',113936,
      'fee_exclusions','ALU Theory Exam/Migration/Degree/Certificate/Marksheet/registration charges payable directly to ALU',
      'year_1',jsonb_build_object('fee',35873,'installment',2291,'installment_count',6,'payment_note','22125 Seat Deposit + 13748 in 6 EMIs of 2291','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',38315,'installment',6386,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',39747,'installment',6625,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 35873, 10),
      (v_fs_id, v_tuition_id, 'year_2', 38315, 10),
      (v_fs_id, v_tuition_id, 'year_3', 39747, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-LLB3-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',1000,'uniform_cost',0,
      'seat_reservation_deposit',22125,'total_fee',136772,
      'fee_exclusions','ALU charges payable directly to ALU',
      'year_1',jsonb_build_object('fee',44250,'installment',22125,'installment_count',2,'payment_note','22125 deposit by admission day or 10 Jun 2026 + 22125 by 10 Jan 2027','discount',9000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',45578,'installment',22789,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',9000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',46945,'installment',23472,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',9000,'discount_condition','Full fee on or before 10 Jul 2028')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 44250, 10),
      (v_fs_id, v_tuition_id, 'year_2', 45578, 10),
      (v_fs_id, v_tuition_id, 'year_3', 46945, 10);
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- LAW: LLB Greater Noida (3-year)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE (name ILIKE '%LLB%' OR name ILIKE '%Bachelor%Laws%')
      AND NOT (name ILIKE '%BA%' OR name ILIKE '%Arts%')
      AND EXISTS (
        SELECT 1 FROM public.departments d
          JOIN public.institutions i ON i.id = d.institution_id
          JOIN public.campuses c ON c.id = i.campus_id
        WHERE d.id = courses.department_id AND c.name ILIKE '%Greater Noida%'
      )
    LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-NLLB3-6', true, jsonb_build_object(
      'plan_name','EMI Option 6 Installments','form_fee',1000,'uniform_cost',0,
      'uniform_description','No Uniform. Only Dress Code.',
      'seat_reservation_deposit',22125,'total_fee',113936,
      'fee_exclusions','CCSU Theory Exam/Migration/Degree/Certificate/Marksheet/CCSU registration charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',35873,'installment',2291,'installment_count',6,'payment_note','22125 Seat Deposit + 13748 in 6 EMIs of 2291','discount',0,'discount_condition',''),
      'year_2',jsonb_build_object('fee',38315,'installment',6386,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition',''),
      'year_3',jsonb_build_object('fee',39747,'installment',6625,'installment_count',6,'payment_note','6 EMIs','discount',0,'discount_condition','')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 35873, 10),
      (v_fs_id, v_tuition_id, 'year_2', 38315, 10),
      (v_fs_id, v_tuition_id, 'year_3', 39747, 10);

    INSERT INTO public.fee_structures (course_id, session_id, version, is_active, metadata)
    VALUES (v_course_id, v_session_id, '26-NLLB3-BI', true, jsonb_build_object(
      'plan_name','Installment Fee Option','form_fee',1000,'uniform_cost',0,
      'seat_reservation_deposit',22125,'total_fee',136772,
      'fee_exclusions','CCSU charges payable directly to CCSU',
      'year_1',jsonb_build_object('fee',44250,'installment',22125,'installment_count',2,'payment_note','22125 deposit by admission day or 10 Jun 2026 + 22125 by 10 Jan 2027','discount',9000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',45578,'installment',22789,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',9000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',46945,'installment',23472,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',9000,'discount_condition','Full fee on or before 10 Jul 2028')
    ))
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET metadata = EXCLUDED.metadata
    RETURNING id INTO v_fs_id;
    DELETE FROM public.fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_tuition_id, 'year_1', 44250, 10),
      (v_fs_id, v_tuition_id, 'year_2', 45578, 10),
      (v_fs_id, v_tuition_id, 'year_3', 46945, 10);
  END IF;

END $$;
