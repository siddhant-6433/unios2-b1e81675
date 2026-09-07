-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260902033557 name=campaign_pacing_in_funnel_counts applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
