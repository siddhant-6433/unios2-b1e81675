-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712080823 name=deactivate_course_info_video_v2_automation applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS whatsapp_scheduled_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phone       text NOT NULL,
  template_key text NOT NULL,
  params      jsonb DEFAULT '[]'::jsonb,
  button_urls jsonb,
  send_at     timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_wa_scheduled_sends_due
  ON whatsapp_scheduled_sends (send_at)
  WHERE status = 'pending';

SELECT cron.schedule(
  'flush-scheduled-wa-sends',
  '*/30 * * * *',
  $$SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/whatsapp-scheduled-flush',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', current_setting('app.settings.cron_secret')
      ),
      body := '{}'::jsonb
  )$$
);

UPDATE automation_rules
SET actions = '[{"type": "send_whatsapp", "template_key": "course_info_video_v2", "delay_hours": 12}]'::jsonb,
    updated_at = now()
WHERE id = 'e74f73b5-175b-4153-a00c-1f554ac201e9';
