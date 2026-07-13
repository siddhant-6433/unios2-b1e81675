-- Return course_id on get_applicant_offers_by_phone so the apply portal can
-- attach an approved offer only to the application that matches the offer's
-- programme — not every draft on the same lead.

DROP FUNCTION IF EXISTS public.get_applicant_offers_by_phone(text);

CREATE FUNCTION public.get_applicant_offers_by_phone(_phone text)
RETURNS TABLE (
  lead_id         uuid,
  course_id       uuid,
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
         ol.course_id,
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

COMMENT ON FUNCTION public.get_applicant_offers_by_phone(text) IS
  'Apply-portal: approved offers matched by lead/application phone; includes course_id for per-application offer ownership.';
