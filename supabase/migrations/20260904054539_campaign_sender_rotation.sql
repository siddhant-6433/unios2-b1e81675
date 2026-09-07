-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260904054539 name=campaign_sender_rotation applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS sender_phone_number_ids text[];
ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS business_phone_number_id text,
  ADD COLUMN IF NOT EXISTS business_number text;
