-- Switch five views from SECURITY DEFINER to SECURITY INVOKER.
--
-- Default Postgres behavior runs views with the privileges of the view's
-- creator (postgres), which bypasses the calling user's RLS. Supabase's
-- security advisor flagged all five as ERROR-level "Security Definer View".
--
-- Switching to security_invoker means the view results are filtered by the
-- calling user's RLS on the underlying tables. For staff queries the data
-- they're entitled to see comes through; for users without access to the
-- underlying tables, the view returns an empty set instead of leaking.
--
-- Verified with test-counsellor and test-campus-admin: counsellor sees only
-- their own scoped rows (correct), campus_admin sees all (correct).

ALTER VIEW public.hot_engaged_leads         SET (security_invoker = true);
ALTER VIEW public.unassigned_leads_bucket   SET (security_invoker = true);
ALTER VIEW public.whatsapp_conversations    SET (security_invoker = true);
ALTER VIEW public.overdue_followups         SET (security_invoker = true);
ALTER VIEW public.voice_agent_quality_daily SET (security_invoker = true);
