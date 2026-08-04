-- cloud_dialer_campaign_queue is SECURITY INVOKER so RLS already returns nothing
-- for anon, but there is no reason for the endpoint to exist unauthenticated.

REVOKE ALL ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) TO authenticated;
