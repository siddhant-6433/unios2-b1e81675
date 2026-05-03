-- GA4 attribution columns on leads
--
-- Captures the data needed to send server-side conversion events back to the
-- correct GA4 property via Measurement Protocol. The CRM is shared across 4
-- websites (nimt.ac.in, miraischool.in, school.nimt.ac.in, apply.nimt.ac.in),
-- each with its own GA4 stream. `origin_domain` is the routing key — the
-- relay function maps it to the right measurement_id + API secret.
--
-- ga_client_id is the per-property GA4 client identifier (from the `_ga`
-- cookie). For cross-domain attribution (e.g. nimt.ac.in → apply.nimt.ac.in)
-- we rely on GA4's `linker.domains` config to pass the same client_id along.
-- gclid + utm_* are captured separately for last-click attribution outside GA.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ga_client_id    text,
  ADD COLUMN IF NOT EXISTS ga_session_id   text,
  ADD COLUMN IF NOT EXISTS gclid           text,
  ADD COLUMN IF NOT EXISTS utm_source      text,
  ADD COLUMN IF NOT EXISTS utm_medium      text,
  ADD COLUMN IF NOT EXISTS utm_campaign    text,
  ADD COLUMN IF NOT EXISTS utm_term        text,
  ADD COLUMN IF NOT EXISTS utm_content     text,
  ADD COLUMN IF NOT EXISTS landing_page    text,
  ADD COLUMN IF NOT EXISTS referrer        text,
  ADD COLUMN IF NOT EXISTS origin_domain   text;

-- Index for the relay's lookup pattern (lead_id → ga_client_id + origin_domain)
-- already covered by leads_pkey. No extra indexes needed; these columns are
-- written once at intake and read only by the conversion relay.

COMMENT ON COLUMN public.leads.ga_client_id   IS 'GA4 client_id from _ga cookie. Same value across cross-domain-linked properties.';
COMMENT ON COLUMN public.leads.ga_session_id  IS 'GA4 session_id from _ga_<MID> cookie (3rd segment after timestamp).';
COMMENT ON COLUMN public.leads.gclid          IS 'Google Ads click identifier — required for offline conversion uploads.';
COMMENT ON COLUMN public.leads.origin_domain  IS 'Originating site domain (nimt.ac.in / miraischool.in / school.nimt.ac.in / apply.nimt.ac.in). Routing key for the GA Measurement Protocol relay.';
