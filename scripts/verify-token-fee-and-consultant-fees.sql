-- ============================================================================
-- SHIP-TIME VERIFICATION — token fee engine, walk-in RPC, consultant fee hiding
--
-- Run via Supabase MCP execute_sql (or psql) AFTER applying migrations
--   20260707120000_payment_links_and_pre_admission_token.sql
--   20260707130000_visit_center.sql
--   20260707140000_consultant_fee_management.sql
--
-- Every block is a self-contained DO $$ that RAISES on failure and ROLLS BACK
-- its own writes (RAISE EXCEPTION at the end of the happy path aborts the
-- block's transaction). A clean run prints only NOTICEs ending in "PASS".
-- Nothing is left behind on success or failure.
-- ============================================================================

-- ── 1. Pre-admission token with NO offer → sums count it, but no PAN ───────
DO $$
DECLARE
  v_lead_id uuid;
  v_status jsonb;
  v_pan text;
BEGIN
  INSERT INTO public.leads (name, phone, source)
  VALUES ('VERIFY token-no-offer', '0000000001', 'walk_in')
  RETURNING id INTO v_lead_id;

  INSERT INTO public.lead_payments (lead_id, type, amount, payment_mode, status)
  VALUES (v_lead_id, 'pre_admission_token', 5000, 'gateway', 'confirmed');

  v_status := public.lead_fee_status(v_lead_id);

  IF (v_status->>'token_paid')::numeric <> 5000 THEN
    RAISE EXCEPTION 'FAIL 1a: pre_admission_token not counted in token_paid (got %)', v_status->>'token_paid';
  END IF;
  IF (v_status->>'twenty_five_complete')::boolean THEN
    RAISE EXCEPTION 'FAIL 1b: twenty_five_complete true with no offer/fee structure';
  END IF;

  SELECT pre_admission_no INTO v_pan FROM public.leads WHERE id = v_lead_id;
  IF v_pan IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1c: PAN issued without an offer (%).', v_pan;
  END IF;

  RAISE NOTICE 'CHECK 1 (pre-offer token: counted, no PAN) PASS';
  RAISE EXCEPTION 'ROLLBACK 1 (intentional — test data discarded)';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'ROLLBACK%' THEN RAISE; END IF;
END $$;

-- ── 2. recompute_lead_fee_stage exists, is callable, and is trigger-wired ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'recompute_lead_fee_stage' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL 2a: recompute_lead_fee_stage missing or not SECURITY DEFINER';
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE proname = 'handle_lead_payment_change' LIMIT 1)
     NOT LIKE '%recompute_lead_fee_stage%' THEN
    RAISE EXCEPTION 'FAIL 2b: lead-payments trigger does not delegate to recompute_lead_fee_stage';
  END IF;

  -- Callable on a nonexistent lead without error (no-op).
  PERFORM public.recompute_lead_fee_stage(gen_random_uuid());

  RAISE NOTICE 'CHECK 2 (recompute_lead_fee_stage wiring) PASS';
END $$;

-- ── 3. is_fee_hidden_for_student fails OPEN ────────────────────────────────
DO $$
DECLARE
  v_student_id uuid;
  v_consultant_id uuid;
  v_course_id uuid;
  v_session_id uuid;
BEGIN
  SELECT id INTO v_course_id FROM public.courses LIMIT 1;
  SELECT id INTO v_session_id FROM public.admission_sessions LIMIT 1;
  IF v_course_id IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK 3 (skipped — no course/session seed rows available)';
  END IF;

  INSERT INTO public.consultants (name, stage) VALUES ('VERIFY consultant', 'active')
  RETURNING id INTO v_consultant_id;
  -- admission_date + joining_academic_year satisfy the school-student trigger
  -- (enforce_school_student_academic_fields) when the seed course is a school.
  INSERT INTO public.students (name, phone, course_id, session_id, admission_date, joining_academic_year)
  VALUES ('VERIFY hidden-student', '0000000002', v_course_id, v_session_id, CURRENT_DATE, '2026-27')
  RETURNING id INTO v_student_id;

  -- 3a. No visibility row at all → visible.
  IF public.is_fee_hidden_for_student(v_student_id) THEN
    RAISE EXCEPTION 'FAIL 3a: hidden=true with no visibility row';
  END IF;

  -- 3b. Visibility row but NO enabled config → visible (fails open).
  INSERT INTO public.student_fee_visibility (student_id, consultant_id, hidden, set_by)
  VALUES (v_student_id, v_consultant_id, true, '00000000-0000-0000-0000-000000000000');
  IF public.is_fee_hidden_for_student(v_student_id) THEN
    RAISE EXCEPTION 'FAIL 3b: hidden=true without an enabled consultant_fee_management row';
  END IF;

  -- 3c. Enabled config → hidden.
  INSERT INTO public.consultant_fee_management (consultant_id, course_id, session_id, enabled, enabled_by)
  VALUES (v_consultant_id, v_course_id, v_session_id, true, '00000000-0000-0000-0000-000000000000');
  IF NOT public.is_fee_hidden_for_student(v_student_id) THEN
    RAISE EXCEPTION 'FAIL 3c: hidden=false with visibility row + enabled config';
  END IF;

  -- 3d. Disable the config → instantly visible again.
  UPDATE public.consultant_fee_management SET enabled = false WHERE consultant_id = v_consultant_id;
  IF public.is_fee_hidden_for_student(v_student_id) THEN
    RAISE EXCEPTION 'FAIL 3d: hidden=true after config disabled (must fail open)';
  END IF;

  -- 3e. Inactive consultant → visible.
  UPDATE public.consultant_fee_management SET enabled = true WHERE consultant_id = v_consultant_id;
  UPDATE public.consultants SET stage = 'inactive' WHERE id = v_consultant_id;
  IF public.is_fee_hidden_for_student(v_student_id) THEN
    RAISE EXCEPTION 'FAIL 3e: hidden=true for an inactive consultant';
  END IF;

  RAISE NOTICE 'CHECK 3 (is_fee_hidden_for_student fails open) PASS';
  RAISE EXCEPTION 'ROLLBACK 3 (intentional — test data discarded)';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'ROLLBACK%' THEN RAISE; END IF;
END $$;

-- ── 4. consultant_set_fee_visibility rejections ────────────────────────────
-- NOTE: runs as the connection role, so auth.uid() is NULL → the caller has no
-- consultant row and the unlinked-student rejection must fire.
DO $$
DECLARE
  v_student_id uuid;
  v_course_id uuid;
  v_session_id uuid;
BEGIN
  SELECT id INTO v_course_id FROM public.courses LIMIT 1;
  SELECT id INTO v_session_id FROM public.admission_sessions LIMIT 1;
  IF v_course_id IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK 4 (skipped — no course/session seed rows available)';
  END IF;

  INSERT INTO public.students (name, phone, course_id, session_id, admission_date, joining_academic_year)
  VALUES ('VERIFY reject-student', '0000000003', v_course_id, v_session_id, CURRENT_DATE, '2026-27')
  RETURNING id INTO v_student_id;

  BEGIN
    PERFORM public.consultant_set_fee_visibility(v_student_id, true);
    RAISE EXCEPTION 'FAIL 4a: consultant_set_fee_visibility did not reject an unlinked caller';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%not linked to your consultant account%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'CHECK 4 (consultant_set_fee_visibility rejects unlinked caller) PASS';
  RAISE EXCEPTION 'ROLLBACK 4 (intentional — test data discarded)';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'ROLLBACK%' THEN RAISE; END IF;
END $$;

-- ── 5. create_walk_in_visit dedupes by phone ───────────────────────────────
DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.create_walk_in_visit('VERIFY Walk-in', '+91 98888-77777', NULL, NULL, NULL, 'tour', NULL);
  -- Same phone, differently formatted → must dedupe to the same lead.
  v_second := public.create_walk_in_visit('VERIFY Walk-in Again', '9888877777', NULL, NULL, NULL, 'fee talk', NULL);

  IF (v_first->>'lead_id') <> (v_second->>'lead_id') THEN
    RAISE EXCEPTION 'FAIL 5a: phone dedupe created two leads (% vs %)', v_first->>'lead_id', v_second->>'lead_id';
  END IF;
  IF (v_first->>'visit_id') = (v_second->>'visit_id') THEN
    RAISE EXCEPTION 'FAIL 5b: expected two distinct visit rows';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.campus_visits
    WHERE id = (v_first->>'visit_id')::uuid AND visit_type = 'walk_in' AND checked_in_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL 5c: walk-in visit not created checked-in';
  END IF;

  RAISE NOTICE 'CHECK 5 (walk-in dedupe by phone) PASS';
  RAISE EXCEPTION 'ROLLBACK 5 (intentional — test data discarded)';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'ROLLBACK%' THEN RAISE; END IF;
END $$;

-- ── 6. Student fee_ledger policy carries the hide gate ─────────────────────
DO $$
DECLARE
  v_qual text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual
  FROM pg_policy
  WHERE polname = 'Students can view own ledger'
    AND polrelid = 'public.fee_ledger'::regclass;

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'FAIL 6a: student fee_ledger SELECT policy missing';
  END IF;
  IF v_qual NOT LIKE '%is_fee_hidden_for_student%' THEN
    RAISE EXCEPTION 'FAIL 6b: policy lacks the is_fee_hidden_for_student gate: %', v_qual;
  END IF;

  RAISE NOTICE 'CHECK 6 (fee_ledger student policy gate) PASS';
END $$;
