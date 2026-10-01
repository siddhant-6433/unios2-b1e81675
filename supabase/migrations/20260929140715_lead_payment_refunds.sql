-- keep-migration-version
-- lead payment refunds
-- Allow the existing finance refund workflow to cover pre-admission lead
-- payments that do not yet have a student fee-ledger allocation.

ALTER TABLE public.fee_refunds
  ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE public.fee_refunds
  ADD CONSTRAINT fee_refunds_student_or_lead_ck
  CHECK (student_id IS NOT NULL OR lead_id IS NOT NULL);

ALTER TABLE public.fee_refund_items
  ALTER COLUMN fee_ledger_payment_id DROP NOT NULL,
  ALTER COLUMN fee_ledger_id DROP NOT NULL;

ALTER TABLE public.fee_refund_items
  ADD CONSTRAINT fee_refund_items_source_ck CHECK (
    (fee_ledger_payment_id IS NOT NULL AND fee_ledger_id IS NOT NULL)
    OR (fee_ledger_payment_id IS NULL AND fee_ledger_id IS NULL AND lead_payment_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_fee_refund_items_lead_payment
  ON public.fee_refund_items (lead_payment_id);

CREATE OR REPLACE FUNCTION public.get_refundable_lead_payment(_lead_payment_id uuid)
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
   WHERE lp.id = _lead_payment_id
     AND lp.type <> 'application_fee'
     AND lp.status = 'confirmed'
     AND public.can_manage_fee_refund(auth.uid())
     AND lp.amount - COALESCE(r.refunded, 0) > 0.009;
$function$;
GRANT EXECUTE ON FUNCTION public.get_refundable_lead_payment(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_lead_payment_refund(
  _lead_payment_id uuid,
  _amount numeric,
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
  v_payment public.lead_payments%ROWTYPE;
  v_already numeric := 0;
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
  IF COALESCE(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be positive';
  END IF;

  SELECT * INTO v_payment
    FROM public.lead_payments
   WHERE id = _lead_payment_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead payment not found'; END IF;
  IF v_payment.type = 'application_fee' THEN
    RAISE EXCEPTION 'Application fees are not eligible for this refund flow';
  END IF;
  IF v_payment.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed lead payments can be refunded';
  END IF;

  SELECT COALESCE(SUM(fri.amount), 0) INTO v_already
    FROM public.fee_refund_items fri
    JOIN public.fee_refunds fr ON fr.id = fri.refund_id
   WHERE fri.lead_payment_id = _lead_payment_id AND fr.status <> 'rejected';
  IF _amount > v_payment.amount - v_already + 0.009 THEN
    RAISE EXCEPTION 'Refund exceeds remaining refundable amount %', v_payment.amount - v_already;
  END IF;

  INSERT INTO public.fee_refunds (
    student_id, lead_id, total_amount, reason, status,
    bank_account_name, bank_account_number, bank_ifsc, bank_name, bank_upi,
    bank_verified_name, bank_verified_at, bank_verification_ref, bank_verification_status,
    proof_url, notes, created_by
  ) VALUES (
    v_payment.student_id, v_payment.lead_id, _amount, btrim(_reason), 'draft',
    _bank->>'account_name', _bank->>'account_number', _bank->>'ifsc', _bank->>'bank_name', _bank->>'upi',
    _bank->>'verified_name', NULLIF(_bank->>'verified_at', '')::timestamptz,
    _bank->>'verification_ref', COALESCE(NULLIF(_bank->>'verification_status', ''), 'unverified'),
    _proof_url, _notes, v_actor
  ) RETURNING id INTO v_refund_id;

  -- Use existing ledger allocation rows first so the established paid-refund
  -- trigger reverses ledger balances. Any unallocated receipt remainder is
  -- recorded directly against the lead payment.
  v_remaining := _amount;
  FOR v_alloc IN
    SELECT flp.id, flp.fee_ledger_id, flp.amount
      FROM public.fee_ledger_payments flp
     WHERE flp.lead_payment_id = _lead_payment_id
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
      VALUES (v_refund_id, v_alloc.id, v_alloc.fee_ledger_id, _lead_payment_id, v_take);
      v_remaining := v_remaining - v_take;
    END IF;
  END LOOP;

  IF v_remaining > 0.009 THEN
    INSERT INTO public.fee_refund_items
      (refund_id, fee_ledger_payment_id, fee_ledger_id, lead_payment_id, amount)
    VALUES (v_refund_id, NULL, NULL, _lead_payment_id, v_remaining);
  END IF;
  RETURN v_refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_lead_payment_refund(uuid, numeric, text, jsonb, text, text) TO authenticated, service_role;

-- Keep student-ledger and direct lead-payment refunds serialized on the same
-- receipt row. This prevents a race between the two entry points from
-- reserving more than the original lead payment amount.
CREATE OR REPLACE FUNCTION public.create_fee_refund(
  _student_id uuid,
  _reason text,
  _items jsonb,
  _bank jsonb DEFAULT '{}'::jsonb,
  _proof_url text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_refund_id uuid;
  v_lead uuid;
  v_total numeric := 0;
  v_item jsonb;
  v_flp_id uuid;
  v_amt numeric;
  v_flp RECORD;
  v_payment RECORD;
  v_already numeric;
  v_payment_refunded numeric;
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
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one refund line is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = _student_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  SELECT lead_id INTO v_lead FROM public.students WHERE id = _student_id;
  INSERT INTO public.fee_refunds (
    student_id, lead_id, reason, status,
    bank_account_name, bank_account_number, bank_ifsc, bank_name, bank_upi,
    bank_verified_name, bank_verified_at, bank_verification_ref, bank_verification_status,
    proof_url, notes, created_by
  ) VALUES (
    _student_id, v_lead, btrim(_reason), 'draft',
    _bank->>'account_name', _bank->>'account_number', _bank->>'ifsc', _bank->>'bank_name', _bank->>'upi',
    _bank->>'verified_name', NULLIF(_bank->>'verified_at', '')::timestamptz,
    _bank->>'verification_ref', COALESCE(NULLIF(_bank->>'verification_status', ''), 'unverified'),
    _proof_url, _notes, v_actor
  ) RETURNING id INTO v_refund_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_flp_id := (v_item->>'fee_ledger_payment_id')::uuid;
    v_amt := COALESCE((v_item->>'amount')::numeric, 0);
    IF v_amt <= 0 THEN CONTINUE; END IF;

    -- Read the payment id first, lock the receipt, then lock the allocation.
    SELECT flp.id, flp.fee_ledger_id, flp.lead_payment_id, flp.amount, fl.student_id
      INTO v_flp
      FROM public.fee_ledger_payments flp
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
     WHERE flp.id = v_flp_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation % not found', v_flp_id; END IF;
    IF v_flp.student_id <> _student_id THEN
      RAISE EXCEPTION 'Allocation % does not belong to this student', v_flp_id;
    END IF;
    IF v_flp.lead_payment_id IS NOT NULL THEN
      SELECT id, amount INTO v_payment FROM public.lead_payments
       WHERE id = v_flp.lead_payment_id FOR UPDATE;
    END IF;
    SELECT flp.id, flp.fee_ledger_id, flp.lead_payment_id, flp.amount, fl.student_id
      INTO v_flp
      FROM public.fee_ledger_payments flp
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
     WHERE flp.id = v_flp_id
     FOR UPDATE OF flp;

    SELECT COALESCE(SUM(fri.amount), 0) INTO v_already
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
     WHERE fri.fee_ledger_payment_id = v_flp_id AND fr.status <> 'rejected';
    IF v_amt > v_flp.amount - v_already + 0.009 THEN
      RAISE EXCEPTION 'Refund % exceeds remaining refundable % on allocation %',
        v_amt, v_flp.amount - v_already, v_flp_id;
    END IF;

    IF v_flp.lead_payment_id IS NOT NULL THEN
      SELECT COALESCE(SUM(fri.amount), 0) INTO v_payment_refunded
        FROM public.fee_refund_items fri
        JOIN public.fee_refunds fr ON fr.id = fri.refund_id
       WHERE fri.lead_payment_id = v_flp.lead_payment_id AND fr.status <> 'rejected';
      IF v_amt > v_payment.amount - v_payment_refunded + 0.009 THEN
        RAISE EXCEPTION 'Refund exceeds remaining refundable amount % on lead payment %',
          v_payment.amount - v_payment_refunded, v_flp.lead_payment_id;
      END IF;
    END IF;

    INSERT INTO public.fee_refund_items
      (refund_id, fee_ledger_payment_id, fee_ledger_id, lead_payment_id, amount)
    VALUES (v_refund_id, v_flp.id, v_flp.fee_ledger_id, v_flp.lead_payment_id, v_amt);
    v_total := v_total + v_amt;
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Refund total must be positive'; END IF;
  UPDATE public.fee_refunds SET total_amount = v_total WHERE id = v_refund_id;
  RETURN v_refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_fee_refund(uuid, text, jsonb, jsonb, text, text) TO authenticated, service_role;

-- When a refund is paid, reverse ledger allocations and set a lead receipt to
-- refunded only after the cumulative paid refund reaches the receipt amount.
CREATE OR REPLACE FUNCTION public.apply_fee_refund_on_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_payment RECORD;
  v_paid_refunds numeric;
BEGIN
  IF NEW.status = 'paid' AND COALESCE(OLD.status, '') <> 'paid' THEN
    FOR v_item IN
      SELECT fee_ledger_id, SUM(amount) AS amt
        FROM public.fee_refund_items
       WHERE refund_id = NEW.id AND fee_ledger_id IS NOT NULL
       GROUP BY fee_ledger_id
    LOOP
      UPDATE public.fee_ledger
         SET paid_amount = GREATEST(paid_amount - v_item.amt, 0),
             status = CASE
               WHEN (total_amount - concession - GREATEST(paid_amount - v_item.amt, 0)) <= 0 THEN 'paid'
               WHEN due_date < current_date THEN 'overdue'
               ELSE 'due' END,
             updated_at = now()
       WHERE id = v_item.fee_ledger_id;
    END LOOP;

    FOR v_payment IN
      SELECT DISTINCT lp.id, lp.amount
        FROM public.fee_refund_items fri
        JOIN public.lead_payments lp ON lp.id = fri.lead_payment_id
       WHERE fri.refund_id = NEW.id
    LOOP
      SELECT COALESCE(SUM(fri.amount), 0) INTO v_paid_refunds
        FROM public.fee_refund_items fri
        JOIN public.fee_refunds fr ON fr.id = fri.refund_id
       WHERE fri.lead_payment_id = v_payment.id AND fr.status = 'paid';
      IF v_paid_refunds + 0.009 >= v_payment.amount THEN
        UPDATE public.lead_payments SET status = 'refunded'
         WHERE id = v_payment.id AND status = 'confirmed';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.apply_fee_refund_on_paid() FROM PUBLIC, anon, authenticated;
