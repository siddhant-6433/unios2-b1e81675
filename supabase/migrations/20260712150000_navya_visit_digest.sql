-- Daily "campus visits booked by Navya" leadership digest.
-- The voice agent stamps booked_by='navya' on every campus_visits row it
-- creates; a daily cron invokes the navya-visit-digest edge function which
-- emails a table of the last 24h of Navya-booked visits.

ALTER TABLE public.campus_visits
  ADD COLUMN IF NOT EXISTS booked_by text;

-- Recipient config. Ships with empty arrays so nothing sends until a human
-- fills in real addresses; the edge function exits gracefully when 'to' is empty.
INSERT INTO public._app_config (key, value)
VALUES ('navya_visit_digest_recipients', '{"to": [], "cc": []}')
ON CONFLICT (key) DO NOTHING;

-- Daily at 14:30 UTC = 8:00 PM IST. Same _app_config supabase_url/service_role_key
-- net.http_post pattern as counsellor-call-miner's cron.
SELECT cron.schedule(
  'navya-visit-digest-daily',
  '30 14 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/navya-visit-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
