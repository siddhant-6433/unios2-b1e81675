-- Grant applications table permissions to service_role so edge functions
-- (e.g. easebuzz-payment surl handler) can update payment_status.
-- The service_role JWT bypasses RLS but still needs table-level GRANTs.
GRANT SELECT, INSERT, UPDATE ON public.applications TO service_role;
