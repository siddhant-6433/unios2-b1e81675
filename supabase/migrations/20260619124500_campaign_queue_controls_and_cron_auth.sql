-- Marketing campaign queue controls + cron auth fix
--
-- The original marketing dispatcher cron used a service-role JWT stored in
-- _app_config. Production cron was firing, but the Edge Function rejected the
-- request as unauthorized, so campaigns stayed pending with worker_attempts=0.
-- Use the existing Vault CRON_SECRET pattern and give pg_net enough time for a
-- bounded batch to complete.

ALTER TABLE public.whatsapp_campaigns
  DROP CONSTRAINT IF EXISTS whatsapp_campaigns_status_check;
ALTER TABLE public.whatsapp_campaigns
  ADD CONSTRAINT whatsapp_campaigns_status_check
  CHECK (status IN ('pending', 'sending', 'paused', 'terminated', 'completed', 'failed'));

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_status_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_status_check
  CHECK (status IN ('pending', 'sending', 'paused', 'terminated', 'completed', 'failed'));

ALTER TABLE public.whatsapp_campaign_recipients
  DROP CONSTRAINT IF EXISTS whatsapp_campaign_recipients_status_check;
ALTER TABLE public.whatsapp_campaign_recipients
  ADD CONSTRAINT whatsapp_campaign_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped'));

CREATE OR REPLACE FUNCTION public.claim_due_marketing_campaigns(_limit integer DEFAULT 4)
RETURNS TABLE(channel text, campaign_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(_limit, 4), 1), 20);
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT 'whatsapp'::text AS channel, c.id AS campaign_id, c.created_at
      FROM public.whatsapp_campaigns c
     WHERE c.status IN ('pending', 'sending')
       AND coalesce(c.next_attempt_at, now()) <= now()
       AND (c.worker_locked_at IS NULL OR c.worker_locked_at < now() - interval '5 minutes')
       AND EXISTS (
         SELECT 1
           FROM public.whatsapp_campaign_recipients r
          WHERE r.campaign_id = c.id
            AND r.status = 'pending'
       )
    UNION ALL
    SELECT 'email'::text AS channel, c.id AS campaign_id, c.created_at
      FROM public.email_campaigns c
     WHERE c.status IN ('pending', 'sending')
       AND coalesce(c.next_attempt_at, now()) <= now()
       AND (c.worker_locked_at IS NULL OR c.worker_locked_at < now() - interval '5 minutes')
       AND EXISTS (
         SELECT 1
           FROM public.email_campaign_recipients r
          WHERE r.campaign_id = c.id
            AND r.status = 'pending'
       )
     ORDER BY created_at ASC
     LIMIT v_limit
  ),
  locked_whatsapp AS (
    UPDATE public.whatsapp_campaigns c
       SET status = 'sending',
           worker_locked_at = now(),
           worker_attempts = coalesce(c.worker_attempts, 0) + 1,
           worker_error = NULL
      FROM candidates x
     WHERE x.channel = 'whatsapp'
       AND x.campaign_id = c.id
       AND c.status IN ('pending', 'sending')
     RETURNING 'whatsapp'::text AS channel, c.id AS campaign_id
  ),
  locked_email AS (
    UPDATE public.email_campaigns c
       SET status = 'sending',
           worker_locked_at = now(),
           worker_attempts = coalesce(c.worker_attempts, 0) + 1,
           worker_error = NULL
      FROM candidates x
     WHERE x.channel = 'email'
       AND x.campaign_id = c.id
       AND c.status IN ('pending', 'sending')
     RETURNING 'email'::text AS channel, c.id AS campaign_id
  )
  SELECT * FROM locked_whatsapp
  UNION ALL
  SELECT * FROM locked_email;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_marketing_campaigns(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_marketing_campaigns(integer) TO service_role;

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
    body    := jsonb_build_object('limit', 4, 'batch_size', 20),
    timeout_milliseconds := 25000
  )
  $$
);
