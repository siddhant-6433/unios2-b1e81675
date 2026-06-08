-- Applicant portal loan-letter preview needs the admission route printed on
-- the generated education-loan support letter.

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
  letter_url          text,
  loan_letter_url     text,
  admission_mode      text,
  entrance_exam_name  text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ol.id, ol.lead_id, ol.total_fee, ol.scholarship_amount,
         ol.net_fee, ol.token_fee_amount, ol.approval_status, ol.status,
         ol.acceptance_deadline, ol.created_at, ol.letter_url, ol.loan_letter_url,
         ol.admission_mode, ol.entrance_exam_name
  FROM   public.offer_letters ol
  JOIN   public.applications  a  ON a.lead_id = ol.lead_id
  WHERE  a.application_id  = _application_id
    AND  ol.approval_status = 'approved'
  ORDER  BY ol.created_at DESC
  LIMIT  1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offer(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
