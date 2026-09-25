-- Grant the permission helpers to service_role.
--
-- Edge functions that run with the service-role client (resume-parse,
-- interview-meet, hiring-notify, zoho-expense-bill-sync, invite-user,
-- resend-login-notice) call `has_permission(...)` via RPC. It was only granted
-- to `authenticated`, so those calls failed and every such function returned
-- "Forbidden" in production. Also restore the service_role SELECT grant on
-- job_applicants_inbox that the redefined view dropped.

GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO service_role;

GRANT SELECT ON public.job_applicants_inbox TO service_role;
