-- abvmu settle finance role
--
-- Let finance/cashier (accountant) and campus_admin settle an approved ABVMU
-- deposit claim — i.e. record the receipt once the university remits the funds —
-- not just super_admin. Settlement creates the real lead_payments receipt row
-- (which the fee ledger then reflects and the receipt PDF generates for).
-- Only the authorization guard changes; the body is otherwise identical to
-- 20260713180000_abvmu_deposit_claims.sql.

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
  IF v_uid IS NULL OR NOT (
       public.has_role(v_uid, 'super_admin'::app_role)
       OR public.has_role(v_uid, 'accountant'::app_role)
       OR public.has_role(v_uid, 'campus_admin'::app_role)
     ) THEN
    RAISE EXCEPTION 'Only finance (accountant), campus admin, or super admin can settle ABVMU deposit claims';
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
