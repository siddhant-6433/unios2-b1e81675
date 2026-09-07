-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260825151717 name=abvmu_approval_advances_stage applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- abvmu approval advances stage
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

  IF _decision = 'approved' THEN
    PERFORM public.recompute_lead_fee_stage(v_claim.lead_id);
  END IF;

  RETURN jsonb_build_object('id', _claim_id, 'status', _decision, 'amount', v_claim.amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_abvmu_deposit_claim(uuid, text, text) TO authenticated, service_role;

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
