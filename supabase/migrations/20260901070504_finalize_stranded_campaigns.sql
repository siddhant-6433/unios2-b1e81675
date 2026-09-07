-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260901070504 name=finalize_stranded_campaigns applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.finalize_stranded_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_fixed integer := 0;
  v_n     integer;
BEGIN
  WITH counts AS (
    SELECT c.id,
           count(*) FILTER (WHERE r.status IN ('sent','delivered','read'))      AS sent,
           count(*) FILTER (WHERE r.status IN ('failed','skipped','canceled'))  AS failed,
           count(*) FILTER (WHERE r.status = 'pending')                         AS pending
      FROM public.whatsapp_campaigns c
      JOIN public.whatsapp_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.status IN ('pending','sending')
     GROUP BY c.id
    HAVING count(*) FILTER (WHERE r.status = 'pending') = 0
  )
  UPDATE public.whatsapp_campaigns c
     SET sent_count      = counts.sent,
         failed_count    = counts.failed,
         status          = 'completed',
         completed_at    = COALESCE(c.completed_at, now()),
         worker_locked_at = NULL,
         next_attempt_at  = NULL
    FROM counts
   WHERE c.id = counts.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_fixed := v_fixed + v_n;

  WITH counts AS (
    SELECT c.id,
           count(*) FILTER (WHERE r.status = 'sent')                            AS sent,
           count(*) FILTER (WHERE r.status IN ('failed','skipped','canceled'))  AS failed,
           count(*) FILTER (WHERE r.status = 'pending')                         AS pending
      FROM public.email_campaigns c
      JOIN public.email_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.status IN ('pending','sending')
     GROUP BY c.id
    HAVING count(*) FILTER (WHERE r.status = 'pending') = 0
  )
  UPDATE public.email_campaigns c
     SET sent_count      = counts.sent,
         failed_count    = counts.failed,
         status          = 'completed',
         completed_at    = COALESCE(c.completed_at, now()),
         worker_locked_at = NULL,
         next_attempt_at  = NULL
    FROM counts
   WHERE c.id = counts.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_fixed := v_fixed + v_n;

  RETURN v_fixed;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_stranded_campaigns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stranded_campaigns() TO service_role;

DO $do$
BEGIN
  PERFORM cron.unschedule('finalize-stranded-campaigns')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finalize-stranded-campaigns');
END
$do$;

SELECT cron.schedule(
  'finalize-stranded-campaigns',
  '*/5 * * * *',
  $$SELECT public.finalize_stranded_campaigns()$$
);
