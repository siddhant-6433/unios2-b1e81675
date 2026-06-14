-- Marketing campaign background worker
--
-- Bulk WhatsApp/email sends are drained by pg_cron instead of by a browser
-- tab. Each cron tick claims due campaigns with a short lock, sends one
-- bounded batch through the existing channel-specific Edge Function, and
-- schedules the next attempt if pending recipients remain.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS worker_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker_error text;

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS worker_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker_error text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_campaigns_worker_due
  ON public.whatsapp_campaigns (next_attempt_at, worker_locked_at, created_at)
  WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_email_campaigns_worker_due
  ON public.email_campaigns (next_attempt_at, worker_locked_at, created_at)
  WHERE status IN ('pending', 'sending');

UPDATE public.whatsapp_campaigns
   SET next_attempt_at = now()
 WHERE status IN ('pending', 'sending')
   AND next_attempt_at IS NULL;

UPDATE public.email_campaigns
   SET next_attempt_at = now()
 WHERE status IN ('pending', 'sending')
   AND next_attempt_at IS NULL;

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
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/campaign-dispatcher',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := jsonb_build_object('limit', 4, 'batch_size', 50)
  )
  $$
);
