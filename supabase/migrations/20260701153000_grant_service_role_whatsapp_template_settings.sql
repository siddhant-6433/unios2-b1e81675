-- Edge functions use the service-role client to register/update WhatsApp
-- template visibility rows during Meta template list/sync/create flows.
-- RLS bypass does not grant table privileges, so grant explicit access.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_template_settings TO service_role;

