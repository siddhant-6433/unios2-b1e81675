-- Grant service_role full access to tables used by edge functions
-- Required for edge functions that use the service role key

GRANT ALL ON public.user_roles TO service_role;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.whatsapp_otps TO service_role;
