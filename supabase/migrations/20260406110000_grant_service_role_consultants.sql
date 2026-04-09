-- Grant service_role access to consultant tables (needed for edge functions and scripts)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_commissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO service_role;
