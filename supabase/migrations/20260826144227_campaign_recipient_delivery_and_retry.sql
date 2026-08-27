-- Delivery funnel + retry state for WhatsApp bulk campaigns.
--
-- Before this, whatsapp_campaign_recipients had a single overwritable `status`
-- column and no retry accounting: out-of-order Meta webhooks (read before
-- delivered) clobbered state, and any transient failure (ecosystem throttle
-- 131049, 5xx, network blip) was marked terminally `failed` with no requeue.
--
-- These columns let the send loop requeue transient failures with backoff and
-- let the webhook record a real Sent -> Delivered -> Read funnel with per-stage
-- timestamps and a monotonic guard. All nullable / defaulted so the change is
-- backward compatible with in-flight campaigns.

ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS delivered_at   timestamptz,
  ADD COLUMN IF NOT EXISTS read_at        timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code text;

-- The send loop requeues transient failures as status='pending' with a future
-- eligible_at; the batch query already filters (status, eligible_at). Index the
-- retry sweep so requeued recipients are cheap to re-pick.
CREATE INDEX IF NOT EXISTS idx_wa_campaign_recipients_pending_eligible
  ON public.whatsapp_campaign_recipients (campaign_id, eligible_at)
  WHERE status = 'pending';

-- Raise the per-invocation batch from 30 to 120. The send loop now runs a
-- bounded-concurrency pool (SEND_CONCURRENCY) instead of a sequential loop with
-- a 200ms sleep, so a 120-message batch finishes well inside the 55s pg_net
-- budget that a 30-message sequential batch used to strain. 4x the throughput
-- per campaign per minute. (Re-issued idempotently; matches the dispatcher/send
-- clamp caps raised to 200 in the same change.)
SELECT cron.unschedule('marketing-campaign-dispatcher')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-campaign-dispatcher');

SELECT cron.schedule(
  'marketing-campaign-dispatcher',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := coalesce(
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
                 (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               ) || '/functions/v1/campaign-dispatcher',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- Hardcoded to match the CRON_SECRET *env* var the dispatcher checks,
      -- same as every other working cron here. The vault.decrypted_secrets
      -- 'CRON_SECRET' value has drifted stale (see the sb_secret_ key migration
      -- notes) — sourcing it from vault silently 401s the whole pipeline.
      'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
    ),
    body    := jsonb_build_object('limit', 4, 'batch_size', 120),
    timeout_milliseconds := 55000
  )
  $$
);
