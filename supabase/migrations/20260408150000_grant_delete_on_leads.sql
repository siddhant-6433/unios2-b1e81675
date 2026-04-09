-- Grant DELETE privilege on leads and all cascading child tables
-- (RLS policies already restrict this to super_admin only)

GRANT DELETE ON public.leads TO authenticated;
GRANT DELETE ON public.leads TO service_role;

GRANT DELETE ON public.lead_activities TO authenticated, service_role;
GRANT DELETE ON public.lead_followups TO authenticated, service_role;
GRANT DELETE ON public.lead_notes TO authenticated, service_role;
GRANT DELETE ON public.lead_counsellors TO authenticated, service_role;
GRANT DELETE ON public.lead_documents TO authenticated, service_role;
GRANT DELETE ON public.lead_payments TO authenticated, service_role;
GRANT DELETE ON public.lead_merges TO authenticated, service_role;
GRANT DELETE ON public.lead_deletion_requests TO authenticated, service_role;
GRANT DELETE ON public.campus_visits TO authenticated, service_role;
GRANT DELETE ON public.call_logs TO authenticated, service_role;
GRANT DELETE ON public.offer_letters TO authenticated, service_role;
GRANT DELETE ON public.waitlist_entries TO authenticated, service_role;
GRANT DELETE ON public.automation_rule_executions TO authenticated, service_role;
GRANT DELETE ON public.consultant_payouts TO authenticated, service_role;
GRANT DELETE ON public.whatsapp_campaign_recipients TO authenticated, service_role;
