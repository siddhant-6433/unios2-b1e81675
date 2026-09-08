-- Cut Small-compute load: stop Realtime WAL on whatsapp_messages status
-- updates, coalesce status-queue writes, and skip Edge wakeups when queues
-- are empty. Also reinstall reconcile-stale-live-calls (previous cron
-- migration was never applied in production).

-- 1. Status webhooks: one UPDATE per message (latest status in the batch),
--    skip no-op same-status writes so Realtime/WAL is not amplified.
CREATE OR REPLACE FUNCTION public.process_whatsapp_status_batch(_batch_size INT DEFAULT 200)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_ids BIGINT[];
  v_processed INT := 0;
BEGIN
  SELECT array_agg(id) INTO v_batch_ids
  FROM (
    SELECT id FROM whatsapp_status_queue
    WHERE processed_at IS NULL
    ORDER BY queued_at
    LIMIT _batch_size
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_batch_ids IS NULL THEN RETURN 0; END IF;

  UPDATE whatsapp_messages wm
  SET status              = l.status,
      business_phone_number_id = COALESCE(l.business_phone_number_id, wm.business_phone_number_id),
      status_error        = COALESCE(l.errors, wm.status_error)
  FROM (
    SELECT DISTINCT ON (q.wa_message_id)
      q.wa_message_id,
      q.status,
      q.errors,
      q.business_phone_number_id
    FROM whatsapp_status_queue q
    WHERE q.id = ANY(v_batch_ids)
    ORDER BY q.wa_message_id, q.queued_at DESC
  ) l
  WHERE wm.wa_message_id = l.wa_message_id
    AND wm.status IS DISTINCT FROM l.status;

  UPDATE whatsapp_otps wo
  SET wa_status            = l.status,
      wa_status_error      = l.errors,
      wa_status_updated_at = now()
  FROM (
    SELECT DISTINCT ON (q.wa_message_id)
      q.wa_message_id, q.status, q.errors
    FROM whatsapp_status_queue q
    WHERE q.id = ANY(v_batch_ids)
    ORDER BY q.wa_message_id, q.queued_at DESC
  ) l
  WHERE wo.wa_message_id = l.wa_message_id
    AND wo.wa_status IS DISTINCT FROM l.status;

  UPDATE whatsapp_campaign_recipients cr
  SET
    delivered_at    = CASE WHEN l.status IN ('delivered','read') AND cr.delivered_at IS NULL THEN now() ELSE cr.delivered_at END,
    read_at         = CASE WHEN l.status = 'read'      THEN now() ELSE cr.read_at END,
    failed_at       = CASE WHEN l.status = 'failed'    THEN now() ELSE cr.failed_at END,
    error_message   = CASE WHEN l.status = 'failed' AND l.errors IS NOT NULL THEN l.errors::TEXT ELSE cr.error_message END,
    last_error_code = CASE WHEN l.status = 'failed' AND l.errors IS NOT NULL THEN (l.errors->0->>'code') ELSE cr.last_error_code END,
    status          = CASE
      WHEN l.status = 'failed'
        AND (CASE cr.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END) < 2
        THEN 'failed'
      WHEN l.status != 'failed'
        AND (CASE l.status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
          > (CASE cr.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
        THEN l.status
      ELSE cr.status
    END
  FROM (
    SELECT DISTINCT ON (q.wa_message_id)
      q.wa_message_id, q.status, q.errors
    FROM whatsapp_status_queue q
    WHERE q.id = ANY(v_batch_ids)
    ORDER BY q.wa_message_id, q.queued_at DESC
  ) l
  WHERE cr.message_id = l.wa_message_id;

  INSERT INTO lead_activities (lead_id, type, description)
  SELECT DISTINCT ON (wm.lead_id) wm.lead_id, 'system',
    '⚠️ WhatsApp delivery failed — ' || COALESCE(wm.template_key, 'message')
    || COALESCE(' (' || left(q.errors->0->>'title', 120) || ')', '')
  FROM whatsapp_status_queue q
  JOIN whatsapp_messages wm ON wm.wa_message_id = q.wa_message_id
  WHERE q.id = ANY(v_batch_ids)
    AND q.status = 'failed'
    AND wm.lead_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  UPDATE whatsapp_status_queue
  SET processed_at = now()
  WHERE id = ANY(v_batch_ids);

  GET DIAGNOSTICS v_processed = ROW_COUNT;
  RETURN v_processed;
END;
$$;

-- 2. Stop logical-decoding every delivery tick on the CRM/inbox Realtime server.
DO $pub$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_messages;
  END IF;
END;
$pub$;

-- 3. Skip Edge wakeups when there is no work.
CREATE OR REPLACE FUNCTION public.fn_invoke_campaign_dispatcher_if_due()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_campaigns c
    WHERE c.status IN ('pending', 'sending')
      AND coalesce(c.next_attempt_at, now()) <= now()
    LIMIT 1
  ) AND NOT EXISTS (
    SELECT 1 FROM public.email_campaigns c
    WHERE c.status IN ('pending', 'sending')
      AND coalesce(c.next_attempt_at, now()) <= now()
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  SELECT coalesce(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
    (SELECT value FROM public._app_config WHERE key = 'supabase_url')
  ) INTO v_url;
  SELECT coalesce(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
    ''
  ) INTO v_secret;
  IF v_url IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/campaign-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('limit', 4, 'batch_size', 30),
    timeout_milliseconds := 25000
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_invoke_whatsapp_buffer_if_due()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_message_buffers
    WHERE status = 'pending' AND due_at <= now()
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  SELECT coalesce(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
    (SELECT value FROM public._app_config WHERE key = 'supabase_url')
  ) INTO v_url;
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/whatsapp-buffer-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('limit', 50),
    timeout_milliseconds := 25000
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_invoke_easebuzz_fast_if_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.lead_payments
    WHERE gateway = 'easebuzz'
      AND status = 'pending'
      AND created_at > now() - interval '3 hours'
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/easebuzz-payment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{"action":"reconcile-lead-payments","window_minutes":180}'::jsonb,
    timeout_milliseconds := 100000
  );
END;
$$;

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
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_call_records acr
    WHERE acr.status = 'initiated'
      AND acr.call_type IN ('manual', 'inbound')
      AND acr.completed_at IS NULL
      AND acr.student_connected_at IS NULL
      AND acr.disposition IS NULL
      AND acr.created_at < now() - (v_stale_after || ' seconds')::interval
    LIMIT 1
  ) THEN
    RETURN 0;
  END IF;

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

REVOKE ALL ON FUNCTION public.fn_invoke_campaign_dispatcher_if_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_invoke_whatsapp_buffer_if_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_invoke_easebuzz_fast_if_pending() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_live_calls_cron(integer) FROM PUBLIC, anon, authenticated;

DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-whatsapp-status-queue') THEN
    PERFORM cron.unschedule('process-whatsapp-status-queue');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-campaign-dispatcher') THEN
    PERFORM cron.unschedule('marketing-campaign-dispatcher');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-buffer-worker') THEN
    PERFORM cron.unschedule('whatsapp-buffer-worker');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'easebuzz-lead-payment-reconcile-fast') THEN
    PERFORM cron.unschedule('easebuzz-lead-payment-reconcile-fast');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stale-live-calls') THEN
    PERFORM cron.unschedule('reconcile-stale-live-calls');
  END IF;

  PERFORM cron.schedule(
    'process-whatsapp-status-queue',
    '* * * * *',
    $$SELECT process_whatsapp_status_batch(200)$$
  );
  PERFORM cron.schedule(
    'marketing-campaign-dispatcher',
    '* * * * *',
    $$SELECT public.fn_invoke_campaign_dispatcher_if_due()$$
  );
  PERFORM cron.schedule(
    'whatsapp-buffer-worker',
    '*/2 * * * *',
    $$SELECT public.fn_invoke_whatsapp_buffer_if_due()$$
  );
  PERFORM cron.schedule(
    'easebuzz-lead-payment-reconcile-fast',
    '*/2 * * * *',
    $$SELECT public.fn_invoke_easebuzz_fast_if_pending()$$
  );
  PERFORM cron.schedule(
    'reconcile-stale-live-calls',
    '*/2 * * * *',
    $$SELECT public.reconcile_stale_live_calls_cron(90)$$
  );
END;
$sched$;
