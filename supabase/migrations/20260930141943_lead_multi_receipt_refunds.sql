-- keep-migration-version
-- lead multi receipt refunds
-- Support one draft refund against several eligible lead receipts.

CREATE OR REPLACE FUNCTION public.get_refundable_lead_payments(_lead_id uuid, _student_id uuid)
RETURNS TABLE (
  lead_payment_id uuid,
  type text,
  fee_head text,
  receipt_no text,
  payment_date timestamptz,
  gateway text,
  payment_mode text,
  collected numeric,
  already_refunded numeric,
  remaining numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT lp.id, lp.type,
         COALESCE(fc.name, initcap(replace(lp.type, '_', ' '))),
         lp.receipt_no, lp.payment_date, lp.gateway, lp.payment_mode,
         lp.amount,
         COALESCE(r.refunded, 0),
         lp.amount - COALESCE(r.refunded, 0)
    FROM public.lead_payments lp
    LEFT JOIN public.fee_codes fc ON fc.id = lp.fee_code_id
    LEFT JOIN LATERAL (
      SELECT SUM(fri.amount) AS refunded
        FROM public.fee_refund_items fri
        JOIN public.fee_refunds fr ON fr.id = fri.refund_id
       WHERE fri.lead_payment_id = lp.id AND fr.status <> 'rejected'
    ) r ON true
   WHERE (
       (_lead_id IS NOT NULL AND lp.lead_id = _lead_id)
       OR (_lead_id IS NULL AND _student_id IS NOT NULL AND lp.lead_id IS NULL AND lp.student_id = _student_id)
     )
     AND lp.type <> 'application_fee'
     AND lp.status = 'confirmed'
     AND public.can_manage_fee_refund(auth.uid())
     AND lp.amount - COALESCE(r.refunded, 0) > 0.009
   ORDER BY lp.payment_date, lp.created_at, lp.id;
$function$;
GRANT EXECUTE ON FUNCTION public.get_refundable_lead_payments(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_lead_refund(
  _lead_id uuid,
  _student_id uuid,
  _items jsonb,
  _reason text,
  _bank jsonb DEFAULT '{}'::jsonb,
  _proof_url text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_refund_id uuid;
  v_student_id uuid;
  v_payment public.lead_payments%ROWTYPE;
  v_item jsonb;
  v_payment_id uuid;
  v_amount numeric;
  v_already numeric;
  v_total numeric := 0;
  v_remaining numeric;
  v_take numeric;
  v_alloc RECORD;
  v_alloc_refunded numeric;
BEGIN
  IF NOT public.can_manage_fee_refund(v_actor) THEN
    RAISE EXCEPTION 'Not authorized to create fee refunds';
  END IF;
  IF COALESCE(NULLIF(btrim(_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF COALESCE(NULLIF(btrim(_bank->>'account_name'), ''), '') = ''
     OR COALESCE(NULLIF(btrim(_bank->>'account_number'), ''), '') = ''
     OR COALESCE(NULLIF(btrim(_bank->>'ifsc'), ''), '') = '' THEN
    RAISE EXCEPTION 'Payee bank details (account holder name, account number, IFSC) are required';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one receipt refund is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) i
     GROUP BY (i->>'lead_payment_id') HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A receipt can only appear once in a refund request';
  END IF;

  -- Lock all selected receipts in stable order so simultaneous requests cannot
  -- reserve more than the unrefunded balance, even across different receipts.
  PERFORM lp.id
    FROM public.lead_payments lp
    JOIN (
      SELECT DISTINCT (i->>'lead_payment_id')::uuid AS id
        FROM jsonb_array_elements(_items) i
    ) selected ON selected.id = lp.id
   WHERE (
       (_lead_id IS NOT NULL AND lp.lead_id = _lead_id)
       OR (_lead_id IS NULL AND _student_id IS NOT NULL AND lp.lead_id IS NULL AND lp.student_id = _student_id)
     )
   ORDER BY lp.id
   FOR UPDATE OF lp;

  IF _lead_id IS NOT NULL THEN
    SELECT lp.student_id INTO v_student_id
      FROM public.lead_payments lp
     WHERE lp.lead_id = _lead_id AND lp.student_id IS NOT NULL
     ORDER BY lp.created_at DESC
     LIMIT 1;
  ELSE
    v_student_id := _student_id;
  END IF;

  -- Validate every request line before inserting a draft.
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_payment_id := (v_item->>'lead_payment_id')::uuid;
    v_amount := COALESCE((v_item->>'amount')::numeric, 0);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Refund amount must be positive'; END IF;

    SELECT * INTO v_payment FROM public.lead_payments lp
     WHERE lp.id = v_payment_id
       AND (
         (_lead_id IS NOT NULL AND lp.lead_id = _lead_id)
         OR (_lead_id IS NULL AND _student_id IS NOT NULL AND lp.lead_id IS NULL AND lp.student_id = _student_id)
       );
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt % does not belong to this lead', v_payment_id; END IF;
    IF v_payment.type = 'application_fee' THEN
      RAISE EXCEPTION 'Application fees are not eligible for this refund flow';
    END IF;
    IF v_payment.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Only confirmed lead payments can be refunded';
    END IF;

    SELECT COALESCE(SUM(fri.amount), 0) INTO v_already
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
     WHERE fri.lead_payment_id = v_payment_id AND fr.status <> 'rejected';
    IF v_amount > v_payment.amount - v_already + 0.009 THEN
      RAISE EXCEPTION 'Refund exceeds remaining refundable amount % on receipt %',
        v_payment.amount - v_already, v_payment_id;
    END IF;
    v_total := v_total + v_amount;
  END LOOP;

  INSERT INTO public.fee_refunds (
    student_id, lead_id, total_amount, reason, status,
    bank_account_name, bank_account_number, bank_ifsc, bank_name, bank_upi,
    bank_verified_name, bank_verified_at, bank_verification_ref, bank_verification_status,
    proof_url, notes, created_by
  ) VALUES (
    v_student_id, _lead_id, v_total, btrim(_reason), 'draft',
    _bank->>'account_name', _bank->>'account_number', _bank->>'ifsc', _bank->>'bank_name', _bank->>'upi',
    _bank->>'verified_name', NULLIF(_bank->>'verified_at', '')::timestamptz,
    _bank->>'verification_ref', COALESCE(NULLIF(_bank->>'verification_status', ''), 'unverified'),
    _proof_url, _notes, v_actor
  ) RETURNING id INTO v_refund_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_payment_id := (v_item->>'lead_payment_id')::uuid;
    v_remaining := COALESCE((v_item->>'amount')::numeric, 0);
    FOR v_alloc IN
      SELECT flp.id, flp.fee_ledger_id, flp.amount
        FROM public.fee_ledger_payments flp
       WHERE flp.lead_payment_id = v_payment_id
       ORDER BY flp.applied_at, flp.id
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0.009;
      SELECT COALESCE(SUM(fri.amount), 0) INTO v_alloc_refunded
        FROM public.fee_refund_items fri
        JOIN public.fee_refunds fr ON fr.id = fri.refund_id
       WHERE fri.fee_ledger_payment_id = v_alloc.id AND fr.status <> 'rejected';
      v_take := LEAST(v_remaining, GREATEST(v_alloc.amount - v_alloc_refunded, 0));
      IF v_take > 0.009 THEN
        INSERT INTO public.fee_refund_items
          (refund_id, fee_ledger_payment_id, fee_ledger_id, lead_payment_id, amount)
        VALUES (v_refund_id, v_alloc.id, v_alloc.fee_ledger_id, v_payment_id, v_take);
        v_remaining := v_remaining - v_take;
      END IF;
    END LOOP;
    IF v_remaining > 0.009 THEN
      INSERT INTO public.fee_refund_items
        (refund_id, fee_ledger_payment_id, fee_ledger_id, lead_payment_id, amount)
      VALUES (v_refund_id, NULL, NULL, v_payment_id, v_remaining);
    END IF;
  END LOOP;
  RETURN v_refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_lead_refund(uuid, uuid, jsonb, text, jsonb, text, text) TO authenticated, service_role;
