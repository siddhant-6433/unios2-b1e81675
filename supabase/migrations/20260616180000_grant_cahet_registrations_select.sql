-- The CAHET sprint migration (20260615100100_cahet_sprint.sql) enabled RLS on
-- public.cahet_registrations and wrote SELECT/INSERT/UPDATE policies, but never
-- issued the table-level GRANT to `authenticated`. Without the grant the RLS
-- policy is never reached — any direct PostgREST query fails with "permission
-- denied for table cahet_registrations" (42501) before policy evaluation.
--
-- Writes were unaffected because they flow through the SECURITY DEFINER RPC
-- cahet_mark_registered (runs as the table owner), so registrations saved fine.
-- But CahetPendingBadge reads the table directly
-- (supabase.from("cahet_registrations").select("id").eq("lead_id", ...)), and
-- that read was denied. The client swallows the error, so `registered` resolved
-- to false and every eligible lead showed "CAHET pending — register" even after
-- a counsellor had registered it.
--
-- Same root cause as 20260616140000_grant_lead_lists_and_email_campaigns.sql.
--
-- Granting SELECT only: direct INSERT/UPDATE stay disallowed so all writes keep
-- going through cahet_mark_registered (which sets registered_by and logs the
-- lead activity). The existing INSERT/UPDATE policies remain dormant until a
-- grant ever activates them. Row visibility is still gated by the existing
-- "Staff can view cahet registrations" SELECT policy.

GRANT SELECT ON public.cahet_registrations TO authenticated;
GRANT ALL ON public.cahet_registrations TO service_role;
