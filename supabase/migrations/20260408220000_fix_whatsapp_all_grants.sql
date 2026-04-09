-- Fix all grants for whatsapp tables

-- whatsapp_messages: full access for service_role, select/insert/update for authenticated
GRANT ALL ON public.whatsapp_messages TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_messages TO authenticated;

-- whatsapp_conversations view
GRANT SELECT ON public.whatsapp_conversations TO service_role;
GRANT SELECT ON public.whatsapp_conversations TO authenticated;

-- whatsapp_campaigns
GRANT ALL ON public.whatsapp_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_campaigns TO authenticated;

-- whatsapp_campaign_recipients
GRANT ALL ON public.whatsapp_campaign_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_campaign_recipients TO authenticated;

-- automation_rules
GRANT ALL ON public.automation_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;

-- automation_rule_executions
GRANT ALL ON public.automation_rule_executions TO service_role;
GRANT SELECT ON public.automation_rule_executions TO authenticated;
