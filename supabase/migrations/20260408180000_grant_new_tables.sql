-- Grant access on all new tables created today

-- Notifications (counsellors read/update own, service role inserts)
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO service_role;

-- SLA config (admins manage)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_sla_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_sla_config TO service_role;

-- Lead deletion requests
GRANT SELECT, INSERT, UPDATE ON public.lead_deletion_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_deletion_requests TO service_role;
