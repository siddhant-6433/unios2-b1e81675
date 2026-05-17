-- Follow-up to 20260517100000_personal_documents.sql — addresses two
-- security-advisor warnings on the new SECURITY DEFINER functions.

-- The cron trampoline should only be callable from inside the DB
-- (postgres / supabase_admin / pg_cron) — never via the PostgREST RPC
-- surface where any signed-in or anon caller could trigger it.
REVOKE EXECUTE ON FUNCTION public.fn_invoke_personal_doc_reminders() FROM PUBLIC, anon, authenticated;

-- is_personal_dashboard_user() must be callable from inside RLS policies
-- evaluated for authenticated users, but it doesn't need to be exposed to
-- anon (no JWT email = always false anyway).
REVOKE EXECUTE ON FUNCTION public.is_personal_dashboard_user() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_personal_dashboard_user() TO authenticated;
