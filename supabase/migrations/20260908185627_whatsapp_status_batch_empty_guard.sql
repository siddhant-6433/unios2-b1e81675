-- Empty-queue exit before FOR UPDATE, and smaller per-minute batches so a
-- backed-up WhatsApp status queue cannot hold locks for ~2 minutes (max
-- 119s observed on 2026-09-08). Delivery still drains every minute; 80
-- rows/min is enough for production webhook volume without overlapping runs.

CREATE OR REPLACE FUNCTION public.process_whatsapp_status_batch(_batch_size INT DEFAULT 80)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_ids BIGINT[];
  v_processed INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_status_queue WHERE processed_at IS NULL LIMIT 1
  ) THEN
    RETURN 0;
  END IF;

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

DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-whatsapp-status-queue') THEN
    PERFORM cron.unschedule('process-whatsapp-status-queue');
  END IF;
  PERFORM cron.schedule(
    'process-whatsapp-status-queue',
    '* * * * *',
    $$SELECT process_whatsapp_status_batch(80)$$
  );
END;
$sched$;
