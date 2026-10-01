-- lead refund sync idempotency and cent validation
-- Keep all refund routes at currency precision. These table constraints also
-- protect RPCs and service-role writes that do not go through the UI.
ALTER TABLE public.fee_refunds
  ADD CONSTRAINT fee_refunds_total_amount_cent_precision_ck
  CHECK (
    total_amount IS NULL OR total_amount = 0 OR
    (total_amount >= 0.01 AND total_amount = round(total_amount, 2))
  );

ALTER TABLE public.fee_refund_items
  ADD CONSTRAINT fee_refund_items_amount_cent_precision_ck
  CHECK (amount >= 0.01 AND amount = round(amount, 2));

-- numeric(12,2) columns round incoming values before CHECK constraints run,
-- so validate raw JSON/numeric RPC inputs before delegating to the existing
-- transaction-safe implementations.
ALTER FUNCTION public.create_lead_refund(uuid, uuid, jsonb, text, jsonb, text, text)
  RENAME TO create_lead_refund_unvalidated;
REVOKE EXECUTE ON FUNCTION public.create_lead_refund_unvalidated(uuid, uuid, jsonb, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_lead_refund(
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
  v_item jsonb;
  v_amount numeric;
BEGIN
  IF NOT public.can_manage_fee_refund(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to create fee refunds';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one receipt refund is required';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_amount := COALESCE((v_item->>'amount')::numeric, 0);
    IF v_amount < 0.01 OR v_amount <> round(v_amount, 2) THEN
      RAISE EXCEPTION 'Refund amounts must be at least 0.01 and use no more than two decimal places';
    END IF;
  END LOOP;
  RETURN public.create_lead_refund_unvalidated(_lead_id, _student_id, _items, _reason, _bank, _proof_url, _notes);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_lead_refund(uuid, uuid, jsonb, text, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lead_refund(uuid, uuid, jsonb, text, jsonb, text, text)
  TO authenticated, service_role;

ALTER FUNCTION public.create_lead_payment_refund(uuid, numeric, text, jsonb, text, text)
  RENAME TO create_lead_payment_refund_unvalidated;
REVOKE EXECUTE ON FUNCTION public.create_lead_payment_refund_unvalidated(uuid, numeric, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_lead_payment_refund(
  _lead_payment_id uuid,
  _amount numeric,
  _reason text,
  _bank jsonb DEFAULT '{}'::jsonb,
  _proof_url text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_manage_fee_refund(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to create fee refunds';
  END IF;
  IF _amount IS NULL OR _amount < 0.01 OR _amount <> round(_amount, 2) THEN
    RAISE EXCEPTION 'Refund amount must be at least 0.01 and use no more than two decimal places';
  END IF;
  RETURN public.create_lead_payment_refund_unvalidated(_lead_payment_id, _amount, _reason, _bank, _proof_url, _notes);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_lead_payment_refund(uuid, numeric, text, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lead_payment_refund(uuid, numeric, text, jsonb, text, text)
  TO authenticated, service_role;

ALTER FUNCTION public.create_fee_refund(uuid, text, jsonb, jsonb, text, text)
  RENAME TO create_fee_refund_unvalidated;
REVOKE EXECUTE ON FUNCTION public.create_fee_refund_unvalidated(uuid, text, jsonb, jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_fee_refund(
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
  v_item jsonb;
  v_amount numeric;
BEGIN
  IF NOT public.can_manage_fee_refund(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to create fee refunds';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'At least one refund line is required';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_amount := COALESCE((v_item->>'amount')::numeric, 0);
    IF v_amount > 0 AND (v_amount < 0.01 OR v_amount <> round(v_amount, 2)) THEN
      RAISE EXCEPTION 'Refund amounts must be at least 0.01 and use no more than two decimal places';
    END IF;
  END LOOP;
  RETURN public.create_fee_refund_unvalidated(_student_id, _reason, _items, _bank, _proof_url, _notes);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_fee_refund(uuid, text, jsonb, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_fee_refund(uuid, text, jsonb, jsonb, text, text)
  TO authenticated, service_role;

-- Serialize Zoho vendor-payment creation for each refund. A short lease lets a
-- later retry recover if an invocation dies while Zoho is processing a request.
ALTER TABLE public.fee_refunds
  ADD COLUMN zoho_payment_sync_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_fee_refund_zoho_payment_sync(
  _refund_id uuid,
  _user uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_claimed uuid;
BEGIN
  IF NOT public.can_manage_fee_refund(_user) THEN
    RAISE EXCEPTION 'Not authorized to sync fee refunds';
  END IF;

  UPDATE public.fee_refunds
     SET zoho_payment_sync_started_at = now()
   WHERE id = _refund_id
     AND status = 'paid'
     AND zoho_payment_id IS NULL
     AND (zoho_payment_sync_started_at IS NULL
          OR zoho_payment_sync_started_at < now() - interval '5 minutes')
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.claim_fee_refund_zoho_payment_sync(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_fee_refund_zoho_payment_sync(uuid, uuid)
  TO authenticated, service_role;
