-- abvmu approval advances stage
--
-- When a super_admin APPROVES an ABVMU seat-reservation deposit claim, the ₹40k
-- deposit already counts toward `paid_toward_course` in lead_fee_status() via
-- lead_abvmu_approved_credit(). But decide_abvmu_deposit_claim() never re-ran the
-- stage engine, so the lead was left un-advanced: no PAN, no fee-ledger
-- provisioning, and no AN — even though the 25% threshold was met. AN is required
-- for class attendance.
--
-- Fix: on approval, call recompute_lead_fee_stage(). That helper (idempotently)
-- issues the PAN + creates the students row (which triggers fee-ledger
-- provisioning) and issues the AN — but ONLY when lead_docs_ready_for_admission()
-- is true; otherwise it records an "AN pending" activity and leaves the AN for
-- after the mandatory documents are verified. The doc gate and the 25% fee gate
-- are BOTH preserved (no bypass). Generic across every course that has a
-- seat-reservation deposit configured.

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

  -- The approved deposit is now counted in paid_toward_course. Re-run the stage
  -- engine so the lead advances: PAN + fee-ledger provisioning immediately, and
  -- the AN too once mandatory documents are verified (recompute keeps the doc
  -- and fee gates — it does not bypass them).
  IF _decision = 'approved' THEN
    PERFORM public.recompute_lead_fee_stage(v_claim.lead_id);
    -- recompute stamps the PAN + student row, which normally provisions the fee
    -- ledger via an async edge-function trigger. Call the in-DB provisioner
    -- synchronously too so the ledger is guaranteed to exist immediately (it is
    -- idempotent — only inserts missing ledger rows and applies unapplied
    -- payments; no-ops when there is no student row yet).
    PERFORM public.provision_student_fees(v_claim.lead_id);
  END IF;

  RETURN jsonb_build_object('id', _claim_id, 'status', _decision, 'amount', v_claim.amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_abvmu_deposit_claim(uuid, text, text) TO authenticated, service_role;

-- One-time backfill: advance every lead that already has an approved ABVMU claim
-- but was stranded because the old approve path never re-ran the engine.
-- Idempotent — recompute_lead_fee_stage no-ops for leads already at the right stage.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT lead_id
    FROM public.abvmu_deposit_claims
    WHERE status = 'approved' AND lead_id IS NOT NULL
  LOOP
    PERFORM public.recompute_lead_fee_stage(r.lead_id);
  END LOOP;
END $$;
