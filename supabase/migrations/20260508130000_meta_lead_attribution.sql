-- Meta Lead Ads attribution columns
--
-- Captures the campaign / adset / ad / form context for every lead that
-- arrives via the Meta Lead Ads webhook. `meta_leadgen_id` is unique per
-- submission and used for idempotent retries (Meta resends the webhook
-- if our endpoint times out). `raw_form_data` holds the full field_data
-- payload so unmapped questions on the lead form aren't lost.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_leadgen_id    text,
  ADD COLUMN IF NOT EXISTS meta_form_id       text,
  ADD COLUMN IF NOT EXISTS meta_form_name     text,
  ADD COLUMN IF NOT EXISTS meta_ad_id         text,
  ADD COLUMN IF NOT EXISTS meta_ad_name       text,
  ADD COLUMN IF NOT EXISTS meta_adset_id      text,
  ADD COLUMN IF NOT EXISTS meta_adset_name    text,
  ADD COLUMN IF NOT EXISTS meta_campaign_id   text,
  ADD COLUMN IF NOT EXISTS meta_campaign_name text,
  ADD COLUMN IF NOT EXISTS meta_page_id       text,
  ADD COLUMN IF NOT EXISTS meta_platform      text,
  ADD COLUMN IF NOT EXISTS raw_form_data      jsonb;

-- Idempotency key: same leadgen_id from Meta's retry never creates a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS leads_meta_leadgen_id_uniq
  ON public.leads (meta_leadgen_id)
  WHERE meta_leadgen_id IS NOT NULL;

-- Per-campaign reporting indexes
CREATE INDEX IF NOT EXISTS leads_meta_campaign_id_idx
  ON public.leads (meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_meta_form_id_idx
  ON public.leads (meta_form_id) WHERE meta_form_id IS NOT NULL;

COMMENT ON COLUMN public.leads.meta_leadgen_id   IS 'Meta Lead Ads leadgen_id — unique per submission, used for de-dup on webhook retries';
COMMENT ON COLUMN public.leads.raw_form_data     IS 'Full Meta Lead form field_data JSON for fields not mapped to standard columns';
COMMENT ON COLUMN public.leads.meta_platform     IS 'fb | ig — which Meta platform the lead came from';
