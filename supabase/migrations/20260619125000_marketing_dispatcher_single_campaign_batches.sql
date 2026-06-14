-- Keep marketing dispatcher cron bounded.
--
-- A 20-recipient WhatsApp batch can exceed pg_net's timeout once provider
-- latency is included. Claim one campaign per tick and process a smaller batch
-- so locks are released promptly and other campaigns do not sit claimed before
-- their turn.

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
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body    := jsonb_build_object('limit', 1, 'batch_size', 10),
    timeout_milliseconds := 25000
  )
  $$
);

UPDATE public.whatsapp_campaigns
   SET worker_locked_at = NULL
 WHERE status IN ('pending', 'sending')
   AND worker_locked_at IS NOT NULL;

UPDATE public.email_campaigns
   SET worker_locked_at = NULL
 WHERE status IN ('pending', 'sending')
   AND worker_locked_at IS NOT NULL;
