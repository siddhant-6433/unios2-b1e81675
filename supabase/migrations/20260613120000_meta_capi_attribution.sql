-- Meta Conversions API (CAPI) attribution columns + audit log.
--
-- Mirrors the GA4 setup (see 20260603100000_leads_ga_attribution_columns
-- and 20260603110000_ga_event_log). The meta-capi-events relay reads
-- these columns to build the user_data block Meta needs for browser-side
-- match quality, and writes one audit row per dispatch attempt.
--
-- fbc: Click identifier. Synthesized from the `fbclid` URL param using
--      Meta's documented format `fb.<subdomain_idx>.<ts_ms>.<fbclid>`.
--      Captured client-side in analytics.captureAttribution().
-- fbp: Browser identifier from the `_fbp` cookie the Pixel sets on first
--      page view. Persists across sessions for ~90 days.
--
-- We deliberately do NOT add client_ip_address / client_user_agent
-- columns here — capturing those requires an HTTP-aware intake path,
-- whereas upsert_application_lead is a SECURITY DEFINER RPC and only
-- sees what the browser passes in. Match Quality is "Good" without
-- them (hashed phone + email + external_id carry the match); a later
-- migration can add the ingest plumbing if Meta dashboards say MQ is
-- low.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS fbc          text,
  ADD COLUMN IF NOT EXISTS fbp          text,
  ADD COLUMN IF NOT EXISTS portal_brand text;

COMMENT ON COLUMN public.leads.fbc IS 'Meta click ID. Format: fb.<subdomain>.<ts_ms>.<fbclid>. Synthesized from fbclid URL param.';
COMMENT ON COLUMN public.leads.fbp IS 'Meta browser ID from _fbp cookie set by the Pixel. Persists ~90 days.';
COMMENT ON COLUMN public.leads.portal_brand IS 'Resolved apply portal brand (nimt / beacon / mirai) at intake. Routing key for the Meta CAPI relay to pick the right pixel + access token.';

CREATE TABLE IF NOT EXISTS public.meta_event_log (
  id              bigserial PRIMARY KEY,
  lead_id         uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  event_name      text NOT NULL,
  event_id        text,            -- dedup key shared with browser Pixel fire
  value           numeric(12,2),
  transaction_id  text,
  pixel_id        text,
  http_status     int,
  fb_trace_id     text,            -- Meta's debug correlation id from the response
  error_message   text,
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_event_log_lead_idx
  ON public.meta_event_log (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meta_event_log_event_idx
  ON public.meta_event_log (event_name, created_at DESC);

ALTER TABLE public.meta_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin reads meta_event_log" ON public.meta_event_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

-- This project doesn't auto-grant service_role on new tables (see all the
-- grant_service_role_* migrations under /supabase/migrations) so the edge
-- function's audit INSERT would silently no-op without these grants. The
-- function catches the insert error and ignores it — meaning Meta events
-- would still ship but the audit log would stay empty. Caught during
-- smoke-testing on 2026-05-20.
GRANT SELECT, INSERT ON public.meta_event_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.meta_event_log_id_seq TO service_role;
