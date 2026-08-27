-- Per-campaign delivery funnel counts for the Marketing analytics UI.
--
-- delivered_at/read_at/failed_at are captured per recipient by the webhook, but
-- whatsapp_campaigns has no delivered/read counters (and deliveries land AFTER a
-- campaign completes, via async webhooks). Rather than maintain drift-prone
-- counters, the UI batches this aggregate over the recipients for the campaigns
-- currently on screen. read implies delivered (the webhook backfills
-- delivered_at when a read receipt arrives), so sent >= delivered >= read.

CREATE OR REPLACE FUNCTION public.campaign_funnel_counts(p_campaign_ids uuid[])
RETURNS TABLE(campaign_id uuid, delivered bigint, read bigint, failed bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.campaign_id,
         count(*) FILTER (WHERE r.delivered_at IS NOT NULL) AS delivered,
         count(*) FILTER (WHERE r.read_at IS NOT NULL)      AS read,
         count(*) FILTER (WHERE r.status = 'failed')        AS failed
    FROM public.whatsapp_campaign_recipients r
   WHERE r.campaign_id = ANY(p_campaign_ids)
   GROUP BY r.campaign_id;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_funnel_counts(uuid[]) TO authenticated, service_role;
