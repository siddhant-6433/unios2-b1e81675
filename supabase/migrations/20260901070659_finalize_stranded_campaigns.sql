-- A campaign whose final "completed" write is lost strands in `sending` forever.
--
-- whatsapp-campaign-send recomputes counts and flips status at the end of each
-- batch. On 2026-09-01 that UPDATE was dropped during a statement-timeout storm
-- and the error was never checked, so two campaigns kept status='sending' with
-- stale sent_counts. Nothing recovers them: claim_due_marketing_campaigns only
-- claims campaigns that still have a `pending` recipient, and these have none.
--
-- The sender now checks that error (so the dispatcher retries), and this is the
-- backstop for a write that is lost after the worker has already returned.
-- Idempotent: it only touches campaigns with zero pending recipients.

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

-- ponytail: plain SQL cron, no edge function — the dispatcher's cron body is a
-- single net.http_post and this needs no network. Every 5 min is ample for a
-- recovery path that normally fixes nothing.
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
