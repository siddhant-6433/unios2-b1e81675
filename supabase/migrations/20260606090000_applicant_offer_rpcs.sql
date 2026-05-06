-- Applicant-facing offer letter RPCs.
-- The offer_letters table is staff-only (TO authenticated). These SECURITY
-- DEFINER functions let the anon applicant portal read its own offer without
-- opening the table to the public.

-- 1. Dashboard preload: all approved offers for a phone number's leads.
CREATE OR REPLACE FUNCTION public.get_applicant_offers_by_phone(_phone text)
RETURNS TABLE (
  lead_id         uuid,
  letter_url      text,
  approval_status text,
  created_at      timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ol.lead_id, ol.letter_url, ol.approval_status, ol.created_at
  FROM   public.offer_letters ol
  JOIN   public.leads l ON l.id = ol.lead_id
  WHERE  l.phone = _phone
  ORDER  BY ol.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offers_by_phone(text) TO anon, authenticated;

-- 2. TokenFeePanel: full offer row for a given application_id.
CREATE OR REPLACE FUNCTION public.get_applicant_offer(_application_id text)
RETURNS TABLE (
  id                  uuid,
  lead_id             uuid,
  total_fee           numeric,
  scholarship_amount  numeric,
  net_fee             numeric,
  token_fee_amount    numeric,
  approval_status     text,
  status              text,
  acceptance_deadline timestamptz,
  created_at          timestamptz,
  letter_url          text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ol.id, ol.lead_id, ol.total_fee, ol.scholarship_amount,
         ol.net_fee, ol.token_fee_amount, ol.approval_status, ol.status,
         ol.acceptance_deadline, ol.created_at, ol.letter_url
  FROM   public.offer_letters ol
  JOIN   public.applications  a  ON a.lead_id = ol.lead_id
  WHERE  a.application_id  = _application_id
    AND  ol.approval_status = 'approved'
  ORDER  BY ol.created_at DESC
  LIMIT  1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offer(text) TO anon, authenticated;
