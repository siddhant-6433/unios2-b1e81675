-- Counsellor-call mining pipeline.
-- Mines student-question -> counsellor-answer pairs from manual call recordings
-- (ai_call_records) into admissions_ai_reply_examples via the counsellor-call-miner
-- edge function. Records are claimed by stamping learning_mined_at so concurrent
-- cron runs never double-process a recording.

ALTER TABLE public.ai_call_records
  ADD COLUMN IF NOT EXISTS learning_mined_at timestamptz;

-- Hot path: fetch the next unmined manual recording, newest first.
CREATE INDEX IF NOT EXISTS idx_ai_call_records_unmined
  ON public.ai_call_records (created_at desc)
  WHERE learning_mined_at IS NULL
    AND call_type = 'manual'
    AND recording_url IS NOT NULL;

-- Kill switch. Miner exits early unless this is 'true' OR the caller passes
-- { "force": true, "limit": N } for a manual seed run. Ships disabled.
INSERT INTO public._app_config (key, value)
VALUES ('counsellor_miner_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Every 2 minutes. The counsellor_miner_enabled flag above is the real switch,
-- so the cron is always-on and cheap when disabled (one early-return call).
SELECT cron.schedule(
  'counsellor-call-miner',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/counsellor-call-miner',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- whatsapp-reply-learning was deployed but never scheduled, so
-- admissions_ai_reply_examples stayed empty. Its default action (ingest_recent)
-- self-limits via MAX_EXAMPLES_PER_RUN (500) and a per-run limit param, and only
-- reads/harvests manual counsellor replies -> safe to run unattended. Hourly.
SELECT cron.schedule(
  'whatsapp-reply-learning-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/whatsapp-reply-learning',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
