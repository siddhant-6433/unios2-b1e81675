-- ====================================================================
-- Payment Links + Pre-Application Token Fee
--
--   1. payment_links table — custom-amount pay links (pre-application token,
--      post-application dues, or custom). Server-authoritative amount; the
--      URL token is the credential. Staff full access; consultants scoped to
--      their own linked leads/students. No anon policy — public resolution
--      happens only through the pay-link edge fn with the service role.
--   2. Widen lead_payments.type CHECK to add 'pre_admission_token' (distinct
--      from offer-driven 'token_fee' for clean reporting + receipt wording).
--   3. Update lead_fee_status() so token/course sums include
--      'pre_admission_token'. Before an offer exists lead_first_year_fee()=0,
--      so token_complete/twenty_five_complete stay false → no premature PAN.
--   4. Extract PAN/AN advancement from handle_lead_payment_change() into
--      SECURITY DEFINER recompute_lead_fee_stage(_lead_id). The trigger calls
--      it; the offer-approval path can also call it so a token paid pre-offer
--      issues the PAN at approval time (owner decision #1).
-- ====================================================================

-- 1. payment_links --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('pre_admission_token', 'fee_due', 'custom')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  note text,
  created_by uuid NOT NULL,
  consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'expired', 'cancelled')),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  gateway text,
  gateway_link_id text,
  short_url text,
  lead_payment_id uuid REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_payment_links_target CHECK (lead_id IS NOT NULL OR student_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_links_lead ON public.payment_links(lead_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_student ON public.payment_links(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_consultant ON public.payment_links(consultant_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON public.payment_links(status);

COMMENT ON TABLE public.payment_links IS
  'Custom-amount payment links. Amount is server-authoritative. The URL token is the only public credential — public resolution runs through the pay-link edge fn (service role), never anon RLS.';

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

-- Staff roles: full access.
DROP POLICY IF EXISTS "Staff can manage payment_links" ON public.payment_links;
CREATE POLICY "Staff can manage payment_links"
  ON public.payment_links FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
  );

-- Consultant: SELECT/INSERT rows for their own consultant row where the
-- lead/student is linked to them.
DROP POLICY IF EXISTS "Consultants can view own payment_links" ON public.payment_links;
CREATE POLICY "Consultants can view own payment_links"
  ON public.payment_links FOR SELECT TO authenticated
  USING (
    consultant_id IN (SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Consultants can create own payment_links" ON public.payment_links;
CREATE POLICY "Consultants can create own payment_links"
  ON public.payment_links FOR INSERT TO authenticated
  WITH CHECK (
    consultant_id IN (SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid()))
    AND (
      (lead_id IS NOT NULL AND lead_id IN (
        SELECT id FROM public.leads
        WHERE consultant_id IN (SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid()))
      ))
      OR
      (student_id IS NOT NULL AND student_id IN (
        SELECT s.id FROM public.students s
        JOIN public.leads l ON l.id = s.lead_id
        WHERE l.consultant_id IN (SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid()))
      ))
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.payment_links TO authenticated, service_role;

-- 2. Widen lead_payments.type CHECK to add 'pre_admission_token' -----------
ALTER TABLE public.lead_payments
  DROP CONSTRAINT IF EXISTS lead_payments_type_check;

ALTER TABLE public.lead_payments
  ADD CONSTRAINT lead_payments_type_check
  CHECK (type IN ('application_fee', 'token_fee', 'registration_fee', 'pre_admission_token', 'other'));

-- 3. lead_fee_status() — include 'pre_admission_token' in token/course sums.
-- Reproduced verbatim from 20260702154500 except the two SUM FILTER lists that
-- gain 'pre_admission_token', and paid_toward_course now folds it in too. All
-- other logic unchanged. Before an offer exists lead_first_year_fee()=0 so both
-- completion flags stay false regardless of a pre-admission token being paid.
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
    COALESCE(SUM(amount) FILTER (WHERE type IN ('token_fee','pre_admission_token') AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'registration_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee','pre_admission_token','other') AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('token_fee','pre_admission_token','other') AND status = 'confirmed'), 0)
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

  SELECT MIN(created_at) INTO v_first_token_at
    FROM public.lead_payments
   WHERE lead_id = _lead_id
     AND type IN ('token_fee','pre_admission_token','other')
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

-- 4. recompute_lead_fee_stage(_lead_id) — PAN/AN advancement extracted from
-- handle_lead_payment_change() so the offer-approval path can also call it.
-- Body is the stage-advancement half of the trigger fn verbatim (from
-- 20260604160000_lifecycle_notifications.sql), parameterised on _lead_id and
-- guarded to be idempotent (COALESCE on existing PAN/AN).
CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status        jsonb;
  v_lead          public.leads%ROWTYPE;
  v_pan           text;
  v_an            text;
  v_student_id    uuid;
  v_token         text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := public.lead_fee_status(_lead_id);

  -- Token complete: PAN + student row + notify pan_issued -----------------
  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_lead.id;
    IF v_student_id IS NULL THEN
      INSERT INTO public.students (
        name, phone, email, guardian_name, guardian_phone,
        course_id, campus_id, lead_id, session_id,
        pre_admission_no, status
      ) VALUES (
        v_lead.name, v_lead.phone, v_lead.email,
        v_lead.guardian_name, v_lead.guardian_phone,
        v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
        v_pan, 'pre_admitted'
      ) RETURNING id INTO v_student_id;
    ELSE
      UPDATE public.students
         SET pre_admission_no = COALESCE(pre_admission_no, v_pan),
             status = COALESCE(status, 'pre_admitted')
       WHERE id = v_student_id;
      SELECT pre_admission_no INTO v_pan FROM public.students WHERE id = v_student_id;
    END IF;

    UPDATE public.leads
       SET pre_admission_no = v_pan,
           stage = 'token_paid'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            'Token fee complete — Pre-admitted with PAN: ' || v_pan,
            'token_paid');

    PERFORM public.fn_notify_event('pan_issued', v_lead.id,
      jsonb_build_object('pre_admission_no', v_pan));

    SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  END IF;

  -- 25% threshold: AN + magic token --------------------------------------
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_has_rejected_doc(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'AN provisioning blocked — one or more documents are rejected. Resolve rejections to issue AN.');
      RETURN;
    END IF;

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students
       SET admission_no = COALESCE(admission_no, v_an),
           status = 'active'
     WHERE lead_id = v_lead.id
     RETURNING admission_no, id INTO v_an, v_student_id;

    UPDATE public.leads
       SET admission_no = v_an,
           stage = 'admitted'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            '25% fee paid — Admitted with AN: ' || v_an,
            'admitted');

    IF v_student_id IS NOT NULL THEN
      INSERT INTO public.student_magic_tokens (
        student_id, lead_id, phone, email, expires_at
      ) VALUES (
        v_student_id, v_lead.id, v_lead.phone, v_lead.email,
        now() + interval '30 days'
      )
      RETURNING token INTO v_token;

      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'Student-portal claim link generated (valid 30 days).');
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_lead_fee_stage(uuid) TO authenticated, service_role;

-- Re-point handle_lead_payment_change() at the extracted RPC. Keeps the BEFORE
-- receipt-numbering branch; the AFTER advancement branch now delegates.
CREATE OR REPLACE FUNCTION public.handle_lead_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- (a) BEFORE INSERT: stamp a sequential receipt_no if not supplied.
  IF (TG_OP = 'INSERT') AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
    RETURN NEW;
  END IF;

  -- (b) AFTER: stage advancement runs only when confirmed.
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;

  PERFORM public.recompute_lead_fee_stage(NEW.lead_id);
  RETURN NEW;
END;
$$;
