-- Apply portal resolves applications/offers strictly by applications.phone
-- (apps) or leads.phone (offers). When those diverge — common after marketing
-- lead ingest keeps an old phone while the candidate OTP-logs in with their
-- real number — the portal shows "start a new application" or hides the offer
-- letter even though APP-… is approved and an offer exists on the lead.
--
-- Example (APP-26-8254 / Anshika Pandey):
--   applications.phone = +916394302406  (real OTP number)
--   leads.phone        = +919971591505  (stale CRM / marketing number)
--   offer_letters row lives on that lead
-- Login with the real phone found the approved app but get_applicant_offers_by_phone
-- returned nothing (lead.phone mismatch). Login with the CRM phone found no
-- approved application (app.phone mismatch) and only a fresh draft.
--
-- Fix: both RPCs match EITHER the application phone OR the linked lead phone.

CREATE OR REPLACE FUNCTION public.get_applicant_applications_by_phone(_phone text)
RETURNS SETOF public.applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _phone IS NULL OR btrim(_phone) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.*
  FROM public.applications a
  WHERE a.phone = _phone
     OR a.lead_id IN (
          SELECT l.id
          FROM public.leads l
          WHERE l.phone = _phone
        )
  ORDER BY a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_applications_by_phone(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_applicant_offers_by_phone(text);

CREATE FUNCTION public.get_applicant_offers_by_phone(_phone text)
RETURNS TABLE (
  lead_id         uuid,
  letter_url      text,
  loan_letter_url text,
  approval_status text,
  created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _phone IS NULL OR btrim(_phone) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ol.lead_id)
         ol.lead_id,
         ol.letter_url,
         ol.loan_letter_url,
         ol.approval_status,
         ol.created_at
  FROM   public.offer_letters ol
  JOIN   public.leads l ON l.id = ol.lead_id
  WHERE  ol.approval_status = 'approved'
    AND  (
           l.phone = _phone
           OR EXISTS (
             SELECT 1
             FROM public.applications a
             WHERE a.lead_id = ol.lead_id
               AND a.phone = _phone
           )
         )
  ORDER  BY ol.lead_id, ol.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offers_by_phone(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_applicant_applications_by_phone(text) IS
  'Apply-portal: applications for a verified phone, including apps whose lead still holds a different CRM phone.';

COMMENT ON FUNCTION public.get_applicant_offers_by_phone(text) IS
  'Apply-portal: approved offers for a verified phone via lead.phone OR linked application phone.';
