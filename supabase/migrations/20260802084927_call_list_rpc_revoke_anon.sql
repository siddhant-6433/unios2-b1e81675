-- SECURITY DEFINER + the PUBLIC default grant let anon call these over
-- /rest/v1/rpc. call_list_progress in particular returned counsellor names and
-- per-person call counts for any list id to an unauthenticated caller.
--
-- Also applied inline in the two migrations that create these functions, so
-- either file alone leaves the grants correct.

REVOKE ALL ON FUNCTION public.can_manage_lead_lists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_lead_lists() TO authenticated;

REVOKE ALL ON FUNCTION public.my_call_lists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_call_lists() TO authenticated;

REVOKE ALL ON FUNCTION public.call_list_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_progress(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.skip_call_list_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_call_list_member(uuid, uuid) TO authenticated;
