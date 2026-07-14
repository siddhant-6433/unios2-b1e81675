-- Campaign queue controls
-- Adds explicit paused/terminated lifecycle states so operators can stop old
-- bulk queues without relying on hidden env flags or deleting rows.

DO $$
BEGIN
  ALTER TABLE public.whatsapp_campaigns
    DROP CONSTRAINT IF EXISTS whatsapp_campaigns_status_check;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.whatsapp_campaigns'::regclass
       AND conname = 'whatsapp_campaigns_status_check'
  ) THEN
    ALTER TABLE public.whatsapp_campaigns
      ADD CONSTRAINT whatsapp_campaigns_status_check
      CHECK (status IN ('pending', 'sending', 'paused', 'completed', 'failed', 'terminated'));
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.whatsapp_campaign_recipients
    DROP CONSTRAINT IF EXISTS whatsapp_campaign_recipients_status_check;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.whatsapp_campaign_recipients'::regclass
       AND conname = 'whatsapp_campaign_recipients_status_check'
  ) THEN
    ALTER TABLE public.whatsapp_campaign_recipients
      ADD CONSTRAINT whatsapp_campaign_recipients_status_check
      CHECK (status IN ('pending', 'sent', 'failed', 'canceled'));
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.email_campaigns
    DROP CONSTRAINT IF EXISTS email_campaigns_status_check;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.email_campaigns'::regclass
       AND conname = 'email_campaigns_status_check'
  ) THEN
    ALTER TABLE public.email_campaigns
      ADD CONSTRAINT email_campaigns_status_check
      CHECK (status IN ('pending', 'sending', 'paused', 'completed', 'failed', 'terminated'));
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.email_campaign_recipients
    DROP CONSTRAINT IF EXISTS email_campaign_recipients_status_check;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.email_campaign_recipients'::regclass
       AND conname = 'email_campaign_recipients_status_check'
  ) THEN
    ALTER TABLE public.email_campaign_recipients
      ADD CONSTRAINT email_campaign_recipients_status_check
      CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'canceled'));
  END IF;
END $$;
