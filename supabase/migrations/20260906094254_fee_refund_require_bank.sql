-- Payee bank details are mandatory for a refund (money-out trust boundary): a
-- refund can't be disbursed without account holder name, account number and
-- IFSC. Guard it server-side too, not just in the dialog.
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
  v_already numeric;
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
    proof_url, notes, created_by)
  VALUES (
    _student_id, v_lead, btrim(_reason), 'draft',
    _bank->>'account_name', _bank->>'account_number', _bank->>'ifsc', _bank->>'bank_name', _bank->>'upi',
    _bank->>'verified_name',
    NULLIF(_bank->>'verified_at','')::timestamptz,
    _bank->>'verification_ref',
    COALESCE(NULLIF(_bank->>'verification_status',''), 'unverified'),
    _proof_url, _notes, v_actor)
  RETURNING id INTO v_refund_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_flp_id := (v_item->>'fee_ledger_payment_id')::uuid;
    v_amt := COALESCE((v_item->>'amount')::numeric, 0);
    IF v_amt <= 0 THEN CONTINUE; END IF;

    SELECT flp.id, flp.fee_ledger_id, flp.lead_payment_id, flp.amount, fl.student_id AS student_id
      INTO v_flp
      FROM public.fee_ledger_payments flp
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
     WHERE flp.id = v_flp_id
     FOR UPDATE OF flp;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation % not found', v_flp_id; END IF;
    IF v_flp.student_id <> _student_id THEN
      RAISE EXCEPTION 'Allocation % does not belong to this student', v_flp_id;
    END IF;

    SELECT COALESCE(SUM(fri.amount), 0) INTO v_already
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
     WHERE fri.fee_ledger_payment_id = v_flp_id AND fr.status <> 'rejected';

    IF v_amt > v_flp.amount - v_already + 0.009 THEN
      RAISE EXCEPTION 'Refund % exceeds remaining refundable % on allocation %',
        v_amt, v_flp.amount - v_already, v_flp_id;
    END IF;

    INSERT INTO public.fee_refund_items
      (refund_id, fee_ledger_payment_id, fee_ledger_id, lead_payment_id, amount)
    VALUES (v_refund_id, v_flp_id, v_flp.fee_ledger_id, v_flp.lead_payment_id, v_amt);
    v_total := v_total + v_amt;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Refund total must be positive';
  END IF;
  UPDATE public.fee_refunds SET total_amount = v_total WHERE id = v_refund_id;
  RETURN v_refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_fee_refund(uuid, text, jsonb, jsonb, text, text) TO authenticated, service_role;
