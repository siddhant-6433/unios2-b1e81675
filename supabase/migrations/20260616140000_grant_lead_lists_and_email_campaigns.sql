-- The original lead_lists + email_campaigns migration enabled RLS but didn't
-- GRANT table-level access to the `authenticated` role. Without grants the
-- RLS policy never gets evaluated — the query fails with "permission denied
-- for table" before reaching policy checks. Surfaced from a counsellor
-- importing 619 leads where the leads inserted fine but the lead_lists
-- INSERT after them failed with the permission error.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_lists TO authenticated;
GRANT ALL ON public.lead_lists TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_list_members TO authenticated;
GRANT ALL ON public.lead_list_members TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_campaigns TO authenticated;
GRANT ALL ON public.email_campaigns TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_campaign_recipients TO authenticated;
GRANT ALL ON public.email_campaign_recipients TO service_role;
