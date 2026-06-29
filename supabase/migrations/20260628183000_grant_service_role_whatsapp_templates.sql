-- Edge functions mirror Meta template create/sync/webhook status changes into
-- whatsapp_templates with the service-role key. RLS bypass alone does not
-- grant table privileges, so grant the service role explicit access.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO service_role;
