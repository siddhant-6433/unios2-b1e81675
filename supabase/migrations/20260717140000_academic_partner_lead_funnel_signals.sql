-- Academic-partner application funnel: correct the token-paid / pre-admitted /
-- admitted counts.
--
-- The portal classified each application lead with applicationFunnelStageOf(),
-- but only fed it {status, payment_status, lead_stage}. The later funnel stages
-- need signals the partner cannot read directly (RLS blocks offer_letters and
-- lead_payments for the academic_partner role), so leads that had paid the
-- token fee / been issued an offer / received a PAN never advanced past "Paid"
-- unless their lead.stage happened to be set — badly undercounting the tail.
--
-- PAN/AN live on public.leads (partner-readable), so the portal reads those from
-- its existing pipeline select. This DEFINER RPC supplies only the two
-- RLS-blocked booleans, scoped to the caller's own partner (or a given partner
-- for super-admins impersonating a portal).

CREATE OR REPLACE FUNCTION public.academic_partner_lead_funnel_signals(_partner_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lead_id uuid, has_offer boolean, has_token_fee_paid boolean)
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
      RAISE EXCEPTION 'Only super-admin users can scope funnel signals by partner id';
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
    l.id AS lead_id,
    EXISTS (SELECT 1 FROM public.offer_letters ol WHERE ol.lead_id = l.id) AS has_offer,
    EXISTS (
      SELECT 1 FROM public.lead_payments p
      WHERE p.lead_id = l.id
        AND p.type = 'token_fee'
        AND p.status = 'confirmed'
    ) AS has_token_fee_paid
  FROM public.leads l
  WHERE l.academic_partner_id = v_partner_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.academic_partner_lead_funnel_signals(uuid) TO authenticated;
