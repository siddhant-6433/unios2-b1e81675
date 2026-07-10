-- Delayed course-info video: send course_info_video_v2 12 hours after lead
-- creation instead of immediately.  This avoids the triple-message blast
-- (lead_welcome + course_info_video_v2 + course_info_v4) that was hitting
-- Meta's MARKETING frequency cap (error 131049).
--
-- 1. Create a lightweight scheduled-sends queue.
-- 2. Register a pg_cron job to flush due rows every 30 min.
-- 3. Update the automation rule to carry delay_hours so the automation
--    engine inserts into the queue instead of firing immediately.

-- ── 1. Scheduled sends table ──
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

CREATE INDEX idx_wa_scheduled_sends_due
  ON whatsapp_scheduled_sends (send_at)
  WHERE status = 'pending';

-- ── 2. pg_cron job — every 30 min ──
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

-- ── 3. Add delay_hours to the automation rule ──
UPDATE automation_rules
SET actions = '[{"type": "send_whatsapp", "template_key": "course_info_video_v2", "delay_hours": 12}]'::jsonb,
    updated_at = now()
WHERE id = 'e74f73b5-175b-4153-a00c-1f554ac201e9';
