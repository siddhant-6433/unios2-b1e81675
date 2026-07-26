-- Internal incentive functions must not be callable via PostgREST by anon/authenticated.
-- They mutate the ledger (or leak lead eligibility) and are only meant to run inside
-- triggers / SECURITY DEFINER call chains (which execute as the function owner, so
-- these revokes do not affect them). Closes the pre-existing fn_try_accrue_incentive
-- exposure as well as the new fn_try_accrue_token.
REVOKE EXECUTE ON FUNCTION public.fn_try_accrue_incentive(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_try_accrue_token(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_incentive_on_visit()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_lead_earns_incentive(uuid) FROM PUBLIC, anon, authenticated;
-- keep service_role on the read-only eligibility helper for admin/debug use
GRANT EXECUTE ON FUNCTION public.fn_lead_earns_incentive(uuid) TO service_role;
