-- ABVMU deposit challan claims (BPT / BMRIT / B.Sc Nursing, etc.)
--
-- Student claims they already paid the university seat-reservation deposit
-- (metadata.seat_reservation_deposit, typically ₹40,000 ABVMUP).
--   pending  → proof uploaded; optional provisional note on applicant UI
--   approved → super_admin accepted; amount reduces course due (no receipt yet)
--   rejected → not accepted
--   settled  → funds later received from ABVMU; lead_payments + receipt created

CREATE TABLE IF NOT EXISTS public.abvmu_deposit_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  offer_letter_id uuid REFERENCES public.offer_letters(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'settled')),
  challan_number text,
  challan_date date,
  paid_at_university date,
  proof_path text NOT NULL,
  proof_file_name text,
  proof_content_type text,
  notes text,
  submitted_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  settled_by uuid REFERENCES auth.users(id),
  settled_at timestamptz,
  settlement_payment_id uuid REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  settlement_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abvmu_deposit_claims_lead
  ON public.abvmu_deposit_claims (lead_id, status);
CREATE INDEX IF NOT EXISTS idx_abvmu_deposit_claims_pending
  ON public.abvmu_deposit_claims (status, submitted_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE public.abvmu_deposit_claims IS
  'Student-uploaded ABVMU/university deposit challans. Approved claims reduce course due provisionally; receipt only on settle when funds arrive from the university.';

ALTER TABLE public.abvmu_deposit_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view abvmu deposit claims" ON public.abvmu_deposit_claims;
CREATE POLICY "Staff view abvmu deposit claims"
  ON public.abvmu_deposit_claims FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.can_view_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Super admin manage abvmu deposit claims" ON public.abvmu_deposit_claims;
CREATE POLICY "Super admin manage abvmu deposit claims"
  ON public.abvmu_deposit_claims FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Applicants insert via SECURITY DEFINER RPC (not direct table insert).
GRANT SELECT ON public.abvmu_deposit_claims TO authenticated;
GRANT ALL ON public.abvmu_deposit_claims TO service_role;

-- Deposit amount from active fee structure metadata (fallback 40000).
CREATE OR REPLACE FUNCTION public.lead_abvmu_deposit_amount(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF((fs.metadata->>'seat_reservation_deposit')::numeric, 0),
    0
  )
  FROM public.leads l
  LEFT JOIN LATERAL (
    SELECT metadata
    FROM public.fee_structures
    WHERE course_id = l.course_id
      AND is_active = true
    ORDER BY created_at DESC
    LIMIT 1
  ) fs ON true
  WHERE l.id = _lead_id;
$$;

GRANT EXECUTE ON FUNCTION public.lead_abvmu_deposit_amount(uuid) TO authenticated, anon, service_role;

-- Approved provisional credit (not settled) reduces course due.
CREATE OR REPLACE FUNCTION public.lead_abvmu_approved_credit(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM public.abvmu_deposit_claims
  WHERE lead_id = _lead_id
    AND status = 'approved';
$$;

GRANT EXECUTE ON FUNCTION public.lead_abvmu_approved_credit(uuid) TO authenticated, anon, service_role;

-- Patch lead_fee_status: add ABVMU provisional credit into paid_toward_course.
CREATE OR REPLACE FUNCTION public.lead_fee_status(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy            jsonb   := public.lead_fee_policy(_lead_id);
  v_pan_pct           numeric := COALESCE((v_policy->>'pan_threshold_pct')::numeric, 10);
  v_an_pct            numeric := COALESCE((v_policy->>'an_threshold_pct')::numeric, 25);
  v_min_instalment    numeric := COALESCE((v_policy->>'min_token_instalment')::numeric, 5000);
  v_lump_pct          numeric := COALESCE((v_policy->>'lump_sum_first_year_waiver_pct')::numeric, 0);
  v_multi_pct         numeric := COALESCE((v_policy->>'multi_year_waiver_pct')::numeric, 0);
  v_window_days       int     := COALESCE((v_policy->>'multi_year_window_days')::numeric, 0);

  v_first_year        numeric := public.lead_first_year_fee(_lead_id);
  v_post_year_1       numeric := public.lead_post_scholarship_year_1(_lead_id);
  v_total_course      numeric := public.lead_total_course_fee(_lead_id);
  v_additional        numeric := GREATEST(v_total_course - v_first_year, 0);

  v_offer_token       numeric;
  v_token_required    numeric;
  v_an_threshold      numeric;

  v_token_paid        numeric;
  v_app_paid          numeric;
  v_registration_paid numeric;
  v_total_paid        numeric;
  v_paid_toward_course numeric;
  v_seat_block_amount numeric := 0;
  v_seat_block_application_credit numeric := 0;
  v_abvmu_credit      numeric := 0;
  v_abvmu_deposit_amount numeric := 0;
  v_first_token_at    timestamptz;
  v_window_expires    timestamptz;
  v_days_since        numeric;
  v_in_window         boolean;
  v_lump_disc         numeric;
  v_multi_disc        numeric;
  v_full_year_due     numeric;
  v_full_course_due   numeric;
BEGIN
  SELECT token_fee_amount
    INTO v_offer_token
    FROM public.offer_letters
   WHERE lead_id = _lead_id
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;

  v_token_required := COALESCE(
    (v_policy->>'token_required_amount')::numeric,
    v_offer_token,
    GREATEST(ROUND(v_post_year_1 * v_pan_pct / 100, 2), v_min_instalment)
  );

  v_an_threshold := COALESCE(
    (v_policy->>'an_threshold_amount')::numeric,
    GREATEST(ROUND(v_post_year_1 * v_an_pct / 100, 2), v_min_instalment)
  );

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'token_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'registration_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee','other') AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('token_fee','other') AND status = 'confirmed'), 0)
  INTO v_token_paid, v_app_paid, v_registration_paid, v_total_paid, v_paid_toward_course
  FROM public.lead_payments
  WHERE lead_id = _lead_id;

  SELECT COALESCE(SUM(fsi.amount), 0)
    INTO v_seat_block_amount
    FROM public.fee_structure_items fsi
    JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
   WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
     AND fsi.term = 'year_1'
     AND (fc.code ILIKE '%SEAT%' OR fc.name ILIKE '%SEAT%BLOCK%');

  v_seat_block_application_credit := LEAST(v_app_paid, v_seat_block_amount);
  v_paid_toward_course := v_paid_toward_course + v_seat_block_application_credit;

  -- Super-admin-approved ABVMU challan: provisional credit (no receipt yet).
  v_abvmu_credit := public.lead_abvmu_approved_credit(_lead_id);
  v_abvmu_deposit_amount := public.lead_abvmu_deposit_amount(_lead_id);
  v_paid_toward_course := v_paid_toward_course + v_abvmu_credit;

  SELECT MIN(created_at) INTO v_first_token_at
    FROM public.lead_payments
   WHERE lead_id = _lead_id
     AND type IN ('token_fee','other')
     AND status = 'confirmed';

  IF v_first_token_at IS NOT NULL THEN
    v_window_expires := v_first_token_at + (v_window_days || ' days')::interval;
    v_days_since     := EXTRACT(EPOCH FROM (now() - v_first_token_at)) / 86400.0;
    v_in_window      := now() <= v_window_expires;
  ELSE
    v_window_expires := NULL;
    v_days_since     := NULL;
    v_in_window      := true;
  END IF;

  v_lump_disc       := ROUND(v_first_year * v_lump_pct / 100, 2);
  v_full_year_due   := GREATEST(v_first_year - v_paid_toward_course - v_lump_disc, 0);

  v_multi_disc      := ROUND(v_additional * v_lump_pct / 100, 2)
                    + (CASE WHEN v_in_window THEN ROUND(v_additional * v_multi_pct / 100, 2) ELSE 0 END);
  v_full_course_due := GREATEST(v_total_course - v_paid_toward_course - v_lump_disc - v_multi_disc, 0);

  RETURN jsonb_build_object(
    'first_year_fee',               v_first_year,
    'post_scholarship_year_1',      v_post_year_1,
    'total_course_fee',             v_total_course,
    'additional_years_fee',         v_additional,
    'token_required',               v_token_required,
    'token_paid',                   v_token_paid,
    'application_paid',             v_app_paid,
    'registration_paid',            v_registration_paid,
    'total_paid',                   v_total_paid,
    'paid_toward_course',           v_paid_toward_course,
    'seat_block_application_credit', v_seat_block_application_credit,
    'abvmu_deposit_amount',         v_abvmu_deposit_amount,
    'abvmu_approved_credit',        v_abvmu_credit,
    'twenty_five_pct',              v_an_threshold,
    'an_threshold',                 v_an_threshold,
    'pan_threshold_pct',            v_pan_pct,
    'an_threshold_pct',             v_an_pct,
    'min_token_instalment',         v_min_instalment,
    'token_complete',               (v_token_required > 0 AND v_paid_toward_course >= v_token_required),
    'twenty_five_complete',         (v_post_year_1 > 0 AND v_paid_toward_course >= v_an_threshold),
    'token_completed_at',           v_first_token_at,
    'multi_year_window_expires_at', v_window_expires,
    'days_since_token',             v_days_since,
    'within_multi_year_window',     v_in_window,
    'lump_sum_pct',                 v_lump_pct,
    'multi_year_pct',               v_multi_pct,
    'multi_year_window_days',       v_window_days,
    'full_first_year_discount',     v_lump_disc,
    'full_first_year_amount_due',   v_full_year_due,
    'full_course_discount',         (v_lump_disc + v_multi_disc),
    'full_course_amount_due',       v_full_course_due,
    'policy',                       v_policy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_status(uuid) TO authenticated, service_role, anon;

-- Applicant (or staff on behalf) submits a claim.
CREATE OR REPLACE FUNCTION public.submit_abvmu_deposit_claim(
  _lead_id uuid,
  _proof_path text,
  _proof_file_name text DEFAULT NULL,
  _proof_content_type text DEFAULT NULL,
  _challan_number text DEFAULT NULL,
  _challan_date date DEFAULT NULL,
  _notes text DEFAULT NULL,
  _amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_amount numeric;
  v_offer_id uuid;
  v_claim_id uuid;
  v_lead_name text;
BEGIN
  IF _lead_id IS NULL OR COALESCE(trim(_proof_path), '') = '' THEN
    RAISE EXCEPTION 'lead_id and proof_path are required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = _lead_id) THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  -- One open claim at a time.
  IF EXISTS (
    SELECT 1 FROM public.abvmu_deposit_claims
    WHERE lead_id = _lead_id AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'An ABVMU deposit claim is already pending or approved for this lead';
  END IF;

  v_amount := COALESCE(NULLIF(_amount, 0), public.lead_abvmu_deposit_amount(_lead_id), 40000);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'No ABVMU seat-reservation deposit configured for this course';
  END IF;

  SELECT id INTO v_offer_id
  FROM public.offer_letters
  WHERE lead_id = _lead_id AND approval_status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT name INTO v_lead_name FROM public.leads WHERE id = _lead_id;

  INSERT INTO public.abvmu_deposit_claims (
    lead_id, offer_letter_id, amount, status,
    challan_number, challan_date, paid_at_university,
    proof_path, proof_file_name, proof_content_type, notes,
    submitted_by
  ) VALUES (
    _lead_id, v_offer_id, v_amount, 'pending',
    NULLIF(trim(_challan_number), ''), _challan_date, _challan_date,
    _proof_path, _proof_file_name, _proof_content_type, NULLIF(trim(_notes), ''),
    v_uid
  )
  RETURNING id INTO v_claim_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
  SELECT
    ur.user_id,
    'approval_pending',
    'ABVMU deposit claim pending',
    COALESCE(v_lead_name, 'A candidate') || ' uploaded an ABVMU deposit challan for ₹'
      || to_char(v_amount, 'FM9G99G99G990') || '. Review in Inbox.',
    '/inbox',
    _lead_id
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin';

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (
    _lead_id,
    (SELECT id FROM public.profiles WHERE user_id = v_uid LIMIT 1),
    'info_update',
    'ABVMU deposit challan submitted (₹' || to_char(v_amount, 'FM9G99G99G990') || ') — pending super admin review'
  );

  RETURN jsonb_build_object(
    'id', v_claim_id,
    'status', 'pending',
    'amount', v_amount,
    'lead_id', _lead_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_abvmu_deposit_claim(uuid, text, text, text, text, date, text, numeric)
  TO authenticated, anon, service_role;

-- Super admin decides claim.
CREATE OR REPLACE FUNCTION public.decide_abvmu_deposit_claim(
  _claim_id uuid,
  _decision text,
  _rejection_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_claim public.abvmu_deposit_claims%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can decide ABVMU deposit claims';
  END IF;
  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected';
  END IF;

  SELECT * INTO v_claim FROM public.abvmu_deposit_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'Claim is already %', v_claim.status;
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  UPDATE public.abvmu_deposit_claims
  SET
    status = _decision,
    reviewed_by = v_uid,
    reviewed_by_name = v_name,
    reviewed_at = now(),
    rejection_reason = CASE WHEN _decision = 'rejected' THEN NULLIF(trim(_rejection_reason), '') ELSE NULL END,
    updated_at = now()
  WHERE id = _claim_id;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (
    v_claim.lead_id,
    (SELECT id FROM public.profiles WHERE user_id = v_uid LIMIT 1),
    'info_update',
    CASE
      WHEN _decision = 'approved' THEN
        'ABVMU deposit claim approved (₹' || to_char(v_claim.amount, 'FM9G99G99G990')
          || ') — year-1 due reduced provisionally; receipt deferred until university remittance'
      ELSE
        'ABVMU deposit claim rejected'
          || CASE WHEN NULLIF(trim(_rejection_reason), '') IS NOT NULL
               THEN ': ' || trim(_rejection_reason) ELSE '' END
    END
  );

  RETURN jsonb_build_object('id', _claim_id, 'status', _decision, 'amount', v_claim.amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_abvmu_deposit_claim(uuid, text, text) TO authenticated, service_role;

-- Super admin settles when funds arrive from ABVMU → create payment (receipt path).
CREATE OR REPLACE FUNCTION public.settle_abvmu_deposit_claim(
  _claim_id uuid,
  _payment_date date DEFAULT CURRENT_DATE,
  _payment_ref text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_claim public.abvmu_deposit_claims%ROWTYPE;
  v_payment_id uuid;
  v_receipt text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can settle ABVMU deposit claims';
  END IF;

  SELECT * INTO v_claim FROM public.abvmu_deposit_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF v_claim.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved claims can be settled (current: %)', v_claim.status;
  END IF;

  v_receipt := 'ABVMU-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(_claim_id::text, '-', ''), 1, 8);

  INSERT INTO public.lead_payments (
    lead_id, type, amount, status, payment_mode, payment_date, transaction_ref, receipt_no, notes, recorded_by
  ) VALUES (
    v_claim.lead_id,
    'other',
    v_claim.amount,
    'confirmed',
    'bank_transfer',
    COALESCE(_payment_date, CURRENT_DATE)::timestamptz,
    COALESCE(NULLIF(trim(_payment_ref), ''), v_claim.challan_number),
    v_receipt,
    COALESCE(NULLIF(trim(_notes), ''), 'ABVMU deposit remittance matched — receipt issued'),
    (SELECT id FROM public.profiles WHERE user_id = v_uid LIMIT 1)
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.abvmu_deposit_claims
  SET
    status = 'settled',
    settled_by = v_uid,
    settled_at = now(),
    settlement_payment_id = v_payment_id,
    settlement_notes = NULLIF(trim(_notes), ''),
    updated_at = now()
  WHERE id = _claim_id;

  -- Approved credit is removed (status settled); payment now counts as real 'other'.
  -- paid_toward_course would double-count if we kept approved credit — settled claims
  -- are excluded from lead_abvmu_approved_credit.

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (
    v_claim.lead_id,
    (SELECT id FROM public.profiles WHERE user_id = v_uid LIMIT 1),
    'info_update',
    'ABVMU deposit settled — payment ' || v_receipt || ' for ₹' || to_char(v_claim.amount, 'FM9G99G99G990')
  );

  RETURN jsonb_build_object(
    'id', _claim_id,
    'status', 'settled',
    'payment_id', v_payment_id,
    'receipt_no', v_receipt
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_abvmu_deposit_claim(uuid, date, text, text) TO authenticated, service_role;

-- Storage: reuse application-documents under abvmu-claims/<lead_id>/...
-- (existing bucket policies already allow application-documents uploads)

-- List claims for a lead (applicant + staff).
CREATE OR REPLACE FUNCTION public.get_abvmu_deposit_claims(_lead_id uuid)
RETURNS SETOF public.abvmu_deposit_claims
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.abvmu_deposit_claims
  WHERE lead_id = _lead_id
  ORDER BY submitted_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_abvmu_deposit_claims(uuid) TO authenticated, anon, service_role;
