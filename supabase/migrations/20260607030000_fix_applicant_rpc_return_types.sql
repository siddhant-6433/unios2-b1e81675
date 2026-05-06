-- Fix return-type mismatches in the two applicant-facing SECURITY DEFINER RPCs.
-- CREATE OR REPLACE cannot change return types, so we DROP + recreate.

-- 1. get_applicant_lead_info: session_id is uuid, not text.
DROP FUNCTION IF EXISTS public.get_applicant_lead_info(uuid);

CREATE FUNCTION public.get_applicant_lead_info(_lead_id uuid)
RETURNS TABLE (
  id               uuid,
  stage            text,
  session_id       uuid,
  pre_admission_no text,
  admission_no     text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, l.stage::text, l.session_id, l.pre_admission_no, l.admission_no
  FROM   public.leads l
  WHERE  l.id = _lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_lead_info(uuid) TO anon, authenticated;

-- 2. get_applicant_offer: acceptance_deadline is date, not timestamptz.
DROP FUNCTION IF EXISTS public.get_applicant_offer(text);

CREATE FUNCTION public.get_applicant_offer(_application_id text)
RETURNS TABLE (
  id                  uuid,
  lead_id             uuid,
  total_fee           numeric,
  scholarship_amount  numeric,
  net_fee             numeric,
  token_fee_amount    numeric,
  approval_status     text,
  status              text,
  acceptance_deadline date,
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
