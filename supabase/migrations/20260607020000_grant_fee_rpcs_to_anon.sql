-- Allow the anon (applicant portal) key to call the fee RPCs.
-- Both functions are already SECURITY DEFINER so they bypass RLS;
-- the only missing piece was the GRANT to anon.
GRANT EXECUTE ON FUNCTION public.lead_fee_status(uuid)   TO anon;
GRANT EXECUTE ON FUNCTION public.lead_year_fees(uuid)    TO anon;
