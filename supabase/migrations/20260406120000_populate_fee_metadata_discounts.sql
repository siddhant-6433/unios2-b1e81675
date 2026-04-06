-- Populate metadata (year-wise breakdown with discount info) on existing fee structures
-- The existing 'standard' version structures have fee_structure_items but null metadata

DO $$
DECLARE
  v_course_id uuid;
  v_fs_id uuid;
BEGIN

  -- ══════════════════════════════════════════════════════════════
  -- B.Sc Nursing
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%B.Sc%Nurs%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    UPDATE public.fee_structures SET metadata = jsonb_build_object(
      'plan_name','Annual Fee (Payable in 2 Installments)','form_fee',1000,'uniform_cost',8000,
      'uniform_description','One Tie, One Blazer, Two Shirts, Two Trousers, One T Shirt, One Scrub Top, One Scrub Bottom, One Underscrub, One Lab Coat (11 items)',
      'seat_reservation_deposit',40000,'total_fee',640095,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU Theory Exam/Migration/Degree/Certificate/Marksheet/Enrollment charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',153000,'installment',78795,'installment_count',2,'payment_note','40000 ABVMUP Deposit + 60500 by 10 Jun 2026 + 60500 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',157590,'installment',78795,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',162318,'installment',81159,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028'),
      'year_4',jsonb_build_object('fee',167187,'installment',83594,'installment_count',2,'payment_note','10 Jul 2029 + 10 Jan 2030','discount',10000,'discount_condition','Full fee on or before 10 Jul 2029')
    )
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- GNM
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%General Nursing%' OR name ILIKE '%GNM%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    UPDATE public.fee_structures SET metadata = jsonb_build_object(
      'plan_name','Annual Fee (Payable in 2 Installments)','form_fee',1000,'uniform_cost',8000,
      'seat_reservation_deposit',5000,'total_fee',364726,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',118000,'installment',60770,'installment_count',2,'payment_note','5000 deposit + 70000+8000 by 10 Jun 2026 + 43000 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',121540,'installment',60770,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',125186,'installment',62593,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028')
    )
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- BMRIT (B.Sc Radiology)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%BMRIT%' OR (name ILIKE '%Radiology%' AND name ILIKE '%B.Sc%') LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    UPDATE public.fee_structures SET metadata = jsonb_build_object(
      'plan_name','Annual Fee (Payable in 2 Installments)','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',40000,'total_fee',284363,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',92000,'installment',47380,'installment_count',2,'payment_note','40000 ABVMUP Deposit + 31000 fee+uniform by 10 Jun 2026 + 27000 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',94760,'installment',47380,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',97603,'installment',48801,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028')
    )
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- DPT (Diploma in Physiotherapy)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%Diploma%Physiotherapy%' OR name ILIKE '%DPT%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    UPDATE public.fee_structures SET metadata = jsonb_build_object(
      'plan_name','Annual Fee (Payable in 2 Installments)','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',20000,'total_fee',125860,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',62000,'installment',31000,'installment_count',2,'payment_note','20000 deposit + 24000 by 10 Jun 2026 + 24000 by 10 Jan 2027','discount',9000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',63860,'installment',31930,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',9000,'discount_condition','Full fee on or before 10 Jul 2027')
    )
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- BPT (Bachelor of Physiotherapy)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%Bachelor%Physiotherapy%' OR name ILIKE '%BPT%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    UPDATE public.fee_structures SET metadata = jsonb_build_object(
      'plan_name','Annual Fee (Payable in 2 Installments)','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',40000,'total_fee',384894,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, ABVMU charges payable directly to ABVMU',
      'year_1',jsonb_build_object('fee',92000,'installment',47380,'installment_count',2,'payment_note','40000 ABVMUP Deposit + 31000 fee+uniform by 10 Jun 2026 + 27000 by 10 Jan 2027','discount',10000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',94760,'installment',47380,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',10000,'discount_condition','Full fee on or before 10 Jul 2027'),
      'year_3',jsonb_build_object('fee',97603,'installment',48801,'installment_count',2,'payment_note','10 Jul 2028 + 10 Jan 2029','discount',10000,'discount_condition','Full fee on or before 10 Jul 2028'),
      'year_4',jsonb_build_object('fee',100531,'installment',50265,'installment_count',2,'payment_note','10 Jul 2029 + 10 Jan 2030','discount',10000,'discount_condition','Full fee on or before 10 Jul 2029')
    )
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- OTT (Diploma in Operation Theater Technician)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%Operation Theater%' OR name ILIKE '%OTT%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    UPDATE public.fee_structures SET metadata = jsonb_build_object(
      'plan_name','Annual Fee (Payable in 2 Installments)','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',20000,'total_fee',125860,
      'fee_exclusions','Clinical Training Fee, Book Bank Fee, UPSMF charges payable directly to UPSMF',
      'year_1',jsonb_build_object('fee',62000,'installment',31000,'installment_count',2,'payment_note','20000 deposit + 24000 by 10 Jun 2026 + 24000 by 10 Jan 2027','discount',9000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',63860,'installment',31930,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',9000,'discount_condition','Full fee on or before 10 Jul 2027')
    )
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- D.Pharma (Diploma in Pharmacy)
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO v_course_id FROM public.courses
    WHERE name ILIKE '%D.Pharma%' OR name ILIKE '%Diploma%Pharmacy%' LIMIT 1;
  IF v_course_id IS NOT NULL THEN
    UPDATE public.fee_structures SET metadata = jsonb_build_object(
      'plan_name','Annual Fee (Payable in 2 Installments)','form_fee',1000,'uniform_cost',6000,
      'seat_reservation_deposit',20000,'total_fee',125860,
      'fee_exclusions','UPBTE/BTE charges payable directly to the board',
      'year_1',jsonb_build_object('fee',62000,'installment',31000,'installment_count',2,'payment_note','20000 deposit + 24000 by 10 Jun 2026 + 24000 by 10 Jan 2027','discount',9000,'discount_condition','Full fee by 10 Jun 2026'),
      'year_2',jsonb_build_object('fee',63860,'installment',31930,'installment_count',2,'payment_note','10 Jul 2027 + 10 Jan 2028','discount',9000,'discount_condition','Full fee on or before 10 Jul 2027')
    )
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true;
  END IF;

END $$;
