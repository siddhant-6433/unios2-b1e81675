-- Surface pacing state so the UI can tell "running" from "stuck".
--
-- A paced campaign spends almost all of its life at status='pending' between
-- daily waves, which looked identical to a genuinely stranded campaign — the
-- table showed "pending"/"scheduled" with no next-wave time and no queue depth.
-- Everything needed is already in whatsapp_campaign_recipients; this returns it
-- in the aggregate the campaigns table already batches, so no extra round-trip.
--
-- pending      = recipients still to send (any eligible_at)
-- due_now      = pending AND already eligible → a worker should be sending these
-- next_eligible_at = when the next wave unlocks (NULL if none pending)

DROP FUNCTION IF EXISTS public.campaign_funnel_counts(uuid[]);

CREATE OR REPLACE FUNCTION public.campaign_funnel_counts(p_campaign_ids uuid[])
RETURNS TABLE(
  campaign_id uuid,
  delivered bigint,
  read bigint,
  failed bigint,
  pending bigint,
  due_now bigint,
  next_eligible_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.campaign_id,
         count(*) FILTER (WHERE r.delivered_at IS NOT NULL) AS delivered,
         count(*) FILTER (WHERE r.read_at IS NOT NULL)      AS read,
         count(*) FILTER (WHERE r.status = 'failed')        AS failed,
         count(*) FILTER (WHERE r.status = 'pending')       AS pending,
         count(*) FILTER (WHERE r.status = 'pending'
                            AND r.eligible_at <= now())     AS due_now,
         min(r.eligible_at) FILTER (WHERE r.status = 'pending') AS next_eligible_at
    FROM public.whatsapp_campaign_recipients r
   WHERE r.campaign_id = ANY(p_campaign_ids)
   GROUP BY r.campaign_id;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_funnel_counts(uuid[]) TO authenticated, service_role;
