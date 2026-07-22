-- Campaign pacing (Meta unique-user / 24h tiers):
-- Recipients get eligible_at so the worker only sends when due.
-- send_mode = paced + daily_unique_cap spreads a list across days
-- without cloning campaigns.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS send_mode text NOT NULL DEFAULT 'immediate',
  ADD COLUMN IF NOT EXISTS daily_unique_cap integer,
  ADD COLUMN IF NOT EXISTS paced_wave_count integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_campaigns_send_mode_check'
      AND conrelid = 'public.whatsapp_campaigns'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_campaigns
      ADD CONSTRAINT whatsapp_campaigns_send_mode_check
      CHECK (send_mode IN ('immediate', 'paced'));
  END IF;
END $$;

ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS eligible_at timestamptz NOT NULL DEFAULT now();

-- Backfill any nulls (defensive if column added without default on old paths)
UPDATE public.whatsapp_campaign_recipients
SET eligible_at = coalesce(eligible_at, created_at, now())
WHERE eligible_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wa_campaign_recipients_eligible
  ON public.whatsapp_campaign_recipients (campaign_id, status, eligible_at)
  WHERE status = 'pending';

COMMENT ON COLUMN public.whatsapp_campaigns.send_mode IS
  'immediate = drain ASAP; paced = respect eligible_at waves for Meta daily unique-user caps.';
COMMENT ON COLUMN public.whatsapp_campaigns.daily_unique_cap IS
  'Max new recipients made eligible per day when send_mode = paced.';
COMMENT ON COLUMN public.whatsapp_campaign_recipients.eligible_at IS
  'Worker must not send before this timestamp (wave pacing).';
