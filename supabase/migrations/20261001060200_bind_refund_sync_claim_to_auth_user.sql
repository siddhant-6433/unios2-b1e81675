-- bind refund sync claim to auth user
-- A caller must not be able to pass another finance user's ID to the payout
-- lease RPC and hold a sync claim on their behalf.
CREATE OR REPLACE FUNCTION public.claim_fee_refund_zoho_payment_sync(
  _refund_id uuid,
  _user uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_claimed uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM _user THEN
    RAISE EXCEPTION 'Refund sync claim must match the authenticated user';
  END IF;
  IF NOT public.can_manage_fee_refund(auth.uid()) THEN
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
