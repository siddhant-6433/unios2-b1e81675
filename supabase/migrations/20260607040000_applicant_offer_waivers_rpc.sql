-- Let the anon applicant key read approved waivers on their own offer letter.
-- offer_waivers is staff-only via RLS; this SECURITY DEFINER function bypasses it.
CREATE OR REPLACE FUNCTION public.get_applicant_offer_waivers(_offer_id uuid)
RETURNS TABLE (term text, amount numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ow.term, ow.amount
  FROM   public.offer_waivers ow
  WHERE  ow.offer_letter_id = _offer_id
    AND  ow.status = 'approved'
  ORDER  BY ow.term;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offer_waivers(uuid) TO anon, authenticated;
