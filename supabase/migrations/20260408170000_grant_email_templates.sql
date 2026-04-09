-- Grant access to email_templates and email_messages for authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO authenticated, service_role;
