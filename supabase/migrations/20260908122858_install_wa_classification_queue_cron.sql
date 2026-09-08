-- process-wa-classification-queue was in git (20260604130000) but never
-- present on production cron.job — the IST-window migration skipped it.
-- Install it on the calling-hour window only. Empty queue returns before
-- looking up secrets or posting to Edge.

CREATE OR REPLACE FUNCTION public.fn_process_wa_classification_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_url  text;
  v_key  text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.wa_classification_queue
    WHERE status = 'pending'
      AND scheduled_at <= now()
      AND created_at <= now() - interval '90 seconds'
      AND attempts < 3
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  SELECT * INTO v_item
  FROM public.wa_classification_queue
  WHERE status = 'pending'
    AND scheduled_at <= now()
    AND created_at <= now() - interval '90 seconds'
    AND attempts < 3
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_item IS NULL THEN RETURN; END IF;

  UPDATE public.wa_classification_queue
     SET status     = 'processing',
         started_at = now(),
         attempts   = attempts + 1
   WHERE id = v_item.id;

  BEGIN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/wa-classify-message',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'queue_id', v_item.id,
        'dispatch_reply', v_item.dispatch_reply
      )
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.wa_classification_queue
       SET status        = 'failed',
           error_message = 'pg_net dispatch error: ' || SQLERRM,
           completed_at  = now()
     WHERE id = v_item.id;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_process_wa_classification_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_process_wa_classification_queue() TO service_role;

DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-wa-classification-queue') THEN
    PERFORM cron.unschedule('process-wa-classification-queue');
  END IF;

  PERFORM cron.schedule(
    'process-wa-classification-queue',
    '* 3-12 * * *',
    $$SELECT public.fn_process_wa_classification_queue()$$
  );
END;
$sched$;
