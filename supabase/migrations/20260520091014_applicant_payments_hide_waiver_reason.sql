-- Stop returning lead_payments.waiver_reason from the applicant-facing RPC.
-- The reason is staff-only context (e.g. "covid hardship", "topper scholarship",
-- internal notes from the counsellor) and must not be visible to the candidate,
-- even via the network response.

DROP FUNCTION IF EXISTS public.get_applicant_payments(uuid);

CREATE OR REPLACE FUNCTION public.get_applicant_payments(_lead_id uuid)
RETURNS TABLE (
  id              uuid,
  receipt_no      text,
  type            text,
  amount          numeric,
  concession_amount numeric,
  payment_mode    text,
  transaction_ref text,
  status          text,
  payment_date    date,
  created_at      timestamptz,
  receipt_url     text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lp.id, lp.receipt_no, lp.type::text, lp.amount, lp.concession_amount,
    lp.payment_mode::text, lp.transaction_ref, lp.status::text,
    lp.payment_date, lp.created_at, lp.receipt_url
  FROM public.lead_payments lp
  WHERE lp.lead_id = _lead_id
  ORDER BY lp.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_payments(uuid) TO anon, authenticated;
