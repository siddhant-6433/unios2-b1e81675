-- Grant service_role access to tables used by edge function ingest APIs
-- (lead-ingest, collegedunia-ingest and similar functions use service_role key)

GRANT SELECT, INSERT, UPDATE ON public.leads TO service_role;
GRANT SELECT, INSERT ON public.lead_activities TO service_role;
GRANT SELECT ON public.courses TO service_role;
GRANT SELECT ON public.campuses TO service_role;
