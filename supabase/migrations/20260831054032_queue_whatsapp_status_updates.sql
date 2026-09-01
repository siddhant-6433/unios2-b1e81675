-- Queue table for WhatsApp delivery status updates (sent/delivered/read/failed).
--
-- Problem: after a bulk WhatsApp send, Meta floods the webhook with 300+
-- delivery receipts per minute. Each receipt processed inline = 5 DB queries
-- × its own edge-function connection. This exhausted the connection pool on
-- 2026-08-31 and took the whole site down for ~40 minutes.
--
-- Fix: the webhook now INSERTs one row here per receipt (1 fast query) and
-- returns 200 immediately. A pg_cron job batch-processes the queue every
-- minute in a single connection.

CREATE TABLE IF NOT EXISTS public.whatsapp_status_queue (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wa_message_id TEXT NOT NULL,
  status     TEXT NOT NULL,           -- sent | delivered | read | failed
  errors     JSONB,
  business_phone_number_id TEXT,
  queued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wsq_unprocessed
  ON public.whatsapp_status_queue (queued_at)
  WHERE processed_at IS NULL;

GRANT ALL ON public.whatsapp_status_queue TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_status_queue_id_seq TO service_role;

-- Batch processor: claims up to _batch_size rows with SKIP LOCKED, applies
-- the same status/campaign-recipient updates the webhook used to do inline,
-- then marks them processed. Returns the count of rows handled.
CREATE OR REPLACE FUNCTION public.process_whatsapp_status_batch(_batch_size INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_ids BIGINT[];
  v_processed INT := 0;
BEGIN
  -- Claim a batch (SKIP LOCKED so parallel runs don't fight)
  SELECT array_agg(id) INTO v_batch_ids
  FROM (
    SELECT id FROM whatsapp_status_queue
    WHERE processed_at IS NULL
    ORDER BY queued_at
    LIMIT _batch_size
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_batch_ids IS NULL THEN RETURN 0; END IF;

  -- 1. Update whatsapp_messages status + error
  UPDATE whatsapp_messages wm
  SET status              = q.status,
      business_phone_number_id = COALESCE(q.business_phone_number_id, wm.business_phone_number_id),
      status_error        = COALESCE(q.errors, wm.status_error)
  FROM whatsapp_status_queue q
  WHERE q.id = ANY(v_batch_ids)
    AND wm.wa_message_id = q.wa_message_id;

  -- 2. Update whatsapp_otps status
  UPDATE whatsapp_otps wo
  SET wa_status            = q.status,
      wa_status_error      = q.errors,
      wa_status_updated_at = now()
  FROM whatsapp_status_queue q
  WHERE q.id = ANY(v_batch_ids)
    AND wo.wa_message_id = q.wa_message_id;

  -- 3. Advance campaign recipient status monotonically
  --    rank: pending=0, sent=1, delivered=2, read=3
  UPDATE whatsapp_campaign_recipients cr
  SET
    delivered_at    = CASE WHEN q.status IN ('delivered','read') AND cr.delivered_at IS NULL THEN now() ELSE cr.delivered_at END,
    read_at         = CASE WHEN q.status = 'read'      THEN now() ELSE cr.read_at END,
    failed_at       = CASE WHEN q.status = 'failed'    THEN now() ELSE cr.failed_at END,
    error_message   = CASE WHEN q.status = 'failed' AND q.errors IS NOT NULL THEN q.errors::TEXT ELSE cr.error_message END,
    last_error_code = CASE WHEN q.status = 'failed' AND q.errors IS NOT NULL THEN (q.errors->0->>'code') ELSE cr.last_error_code END,
    status          = CASE
      -- failed only demotes if not yet delivered
      WHEN q.status = 'failed'
        AND (CASE cr.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END) < 2
        THEN 'failed'
      -- forward-only: sent→delivered→read
      WHEN q.status != 'failed'
        AND (CASE q.status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
          > (CASE cr.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
        THEN q.status
      ELSE cr.status
    END
  FROM whatsapp_status_queue q
  WHERE q.id = ANY(v_batch_ids)
    AND cr.message_id = q.wa_message_id;

  -- 4. Log first-failure events to lead timeline (best-effort, dups harmless)
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

  -- Mark processed
  UPDATE whatsapp_status_queue
  SET processed_at = now()
  WHERE id = ANY(v_batch_ids);

  GET DIAGNOSTICS v_processed = ROW_COUNT;
  RETURN v_processed;
END;
$$;

-- Clean up old processed rows (keep 24h for debugging)
CREATE OR REPLACE FUNCTION public.cleanup_whatsapp_status_queue()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM whatsapp_status_queue
    WHERE processed_at IS NOT NULL
      AND processed_at < now() - INTERVAL '24 hours'
    RETURNING 1
  )
  SELECT count(*)::INT FROM deleted;
$$;

-- ponytail: cron every minute processes the queue in one connection
-- instead of 300+ concurrent webhook connections each doing 5 queries
-- Re-runnable: cron.schedule errors on a duplicate name, and this migration has
-- to be safe to apply twice (it was deployed to prod out of band).
DO $do$
BEGIN
  PERFORM cron.unschedule('process-whatsapp-status-queue')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-whatsapp-status-queue');
  PERFORM cron.unschedule('cleanup-whatsapp-status-queue')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-whatsapp-status-queue');
END
$do$;

SELECT cron.schedule(
  'process-whatsapp-status-queue',
  '* * * * *',
  $$SELECT process_whatsapp_status_batch(500)$$
);

-- Cleanup old rows every hour
SELECT cron.schedule(
  'cleanup-whatsapp-status-queue',
  '15 * * * *',
  $$SELECT cleanup_whatsapp_status_queue()$$
);
