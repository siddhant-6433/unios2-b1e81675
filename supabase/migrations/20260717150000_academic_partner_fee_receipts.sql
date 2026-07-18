-- Academic-partner portal: expose fee receipts for the partner's candidates.
--
-- Fee receipts live in public.lead_payments (receipt_no, receipt_url, amount,
-- payment_date, …). The academic_partner role has no RLS grant on that table,
-- so the Students / Finance tabs could never show what a candidate has paid.
-- This scoped SECURITY DEFINER RPC returns confirmed receipts for leads
-- attributed to the caller's own partner (or a given partner for super-admins).

CREATE OR REPLACE FUNCTION public.academic_partner_fee_receipts(_partner_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(
   lead_id uuid,
   id uuid,
   type text,
   amount numeric,
   concession_amount numeric,
   payment_mode text,
   transaction_ref text,
   receipt_no text,
   receipt_url text,
   status text,
   payment_date timestamp with time zone,
   created_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _partner_id IS NOT NULL THEN
    IF NOT public.has_role(v_uid, 'super_admin'::public.app_role) THEN
      RAISE EXCEPTION 'Only super-admin users can scope fee receipts by partner id';
    END IF;
    v_partner_id := _partner_id;
  ELSE
    SELECT ap.id
      INTO v_partner_id
    FROM public.academic_partners ap
    WHERE ap.user_id = v_uid
      AND ap.status = 'active'
    LIMIT 1;
  END IF;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Academic partner profile not found';
  END IF;

  RETURN QUERY
  SELECT
    lp.lead_id,
    lp.id,
    lp.type,
    lp.amount,
    lp.concession_amount,
    lp.payment_mode,
    lp.transaction_ref,
    lp.receipt_no,
    lp.receipt_url,
    lp.status,
    lp.payment_date,
    lp.created_at
  FROM public.lead_payments lp
  JOIN public.leads l ON l.id = lp.lead_id
  WHERE l.academic_partner_id = v_partner_id
    AND lp.status = 'confirmed'
  ORDER BY lp.payment_date DESC NULLS LAST, lp.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.academic_partner_fee_receipts(uuid) TO authenticated;
