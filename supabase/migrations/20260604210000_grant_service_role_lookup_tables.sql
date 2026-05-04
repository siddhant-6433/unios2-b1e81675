-- notify-event resolves recipients by joining team_members → teams →
-- profiles, and reads user_roles to find super admins. Service role's
-- supabase-js client routes through PostgREST → without explicit
-- GRANTs these queries silently return empty / error, leading to no
-- emails firing. Symptom: "I'm in business hours, why no email?"
--
-- Granting SELECT (not full ALL) — the relay only reads these.

GRANT SELECT ON public.teams         TO service_role;
GRANT SELECT ON public.team_members  TO service_role;
GRANT SELECT ON public.user_roles    TO service_role;
GRANT SELECT ON public.profiles      TO service_role;
GRANT SELECT ON public.email_templates TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.email_messages    TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_messages TO service_role;
