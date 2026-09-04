-- Round-robin sending across several numbers of the same org (throughput).
--
-- A campaign can rotate across N sender numbers; each recipient is assigned one
-- at enqueue time (retry-stable — the same recipient always sends from the same
-- number). The send loop reads the per-recipient number and falls back to the
-- campaign's single sender when rotation isn't used, so existing campaigns are
-- unaffected. sendWhatsAppTemplate resolves the right WABA token per number.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS sender_phone_number_ids text[];

ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS business_phone_number_id text,
  ADD COLUMN IF NOT EXISTS business_number text;
