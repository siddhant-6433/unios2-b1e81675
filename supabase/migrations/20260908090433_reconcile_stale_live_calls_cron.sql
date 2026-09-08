-- LiveCallBar used to call reconcile_stale_live_calls from every open CRM tab
-- every 15s. On a Small instance that is N concurrent UPDATEs on ai_call_records
-- for the same tiny set of initiated rows. Move the writer to one cron.

CREATE OR REPLACE FUNCTION public.reconcile_stale_live_calls_cron(
  p_stale_after_seconds integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_after integer := LEAST(GREATEST(COALESCE(p_stale_after_seconds, 90), 45), 600);
  v_count integer := 0;
BEGIN
  UPDATE public.ai_call_records acr
  SET
    status = 'no_answer',
    disposition = COALESCE(acr.disposition, 'not_answered'),
    duration_seconds = COALESCE(acr.duration_seconds, 0),
    completed_at = COALESCE(acr.completed_at, now()),
    summary = COALESCE(acr.summary, 'Cloud Call timed out before connection')
  WHERE acr.status = 'initiated'
    AND acr.call_type IN ('manual', 'inbound')
    AND acr.completed_at IS NULL
    AND acr.student_connected_at IS NULL
    AND acr.disposition IS NULL
    AND acr.created_at < now() - (v_stale_after || ' seconds')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stale_live_calls_cron(integer) FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  PERFORM cron.unschedule('reconcile-stale-live-calls')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stale-live-calls');
END;
$do$;

SELECT cron.schedule(
  'reconcile-stale-live-calls',
  '*/2 * * * *',
  $$SELECT public.reconcile_stale_live_calls_cron(90)$$
);
