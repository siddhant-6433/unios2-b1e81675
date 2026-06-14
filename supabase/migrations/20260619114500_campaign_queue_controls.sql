-- Campaign queue controls
-- Adds explicit paused/terminated lifecycle states so operators can stop old
-- bulk queues without relying on hidden env flags or deleting rows.

ALTER TABLE public.whatsapp_campaigns
  DROP CONSTRAINT IF EXISTS whatsapp_campaigns_status_check;

ALTER TABLE public.whatsapp_campaigns
  ADD CONSTRAINT whatsapp_campaigns_status_check
  CHECK (status IN ('pending', 'sending', 'paused', 'completed', 'failed', 'terminated'));

ALTER TABLE public.whatsapp_campaign_recipients
  DROP CONSTRAINT IF EXISTS whatsapp_campaign_recipients_status_check;

ALTER TABLE public.whatsapp_campaign_recipients
  ADD CONSTRAINT whatsapp_campaign_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'canceled'));

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_status_check;

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_status_check
  CHECK (status IN ('pending', 'sending', 'paused', 'completed', 'failed', 'terminated'));

ALTER TABLE public.email_campaign_recipients
  DROP CONSTRAINT IF EXISTS email_campaign_recipients_status_check;

ALTER TABLE public.email_campaign_recipients
  ADD CONSTRAINT email_campaign_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'canceled'));
