-- Broaden fn_capi_emit_lead: drop the origin_domain IS NULL guard so the
-- Lead event fires to Meta for ALL inbound leads, not just apply-portal
-- submissions.
--
-- Why:
--   The original gate restricted CAPI Lead events to leads created via the
--   apply portal (which sets origin_domain). In production that excluded
--   ~95% of inbound leads (Meta lead forms, JustDial, CollegeDunia, manual
--   entry, etc.), leaving Meta Events Manager with near-zero Lead volume
--   even though CAPI itself was healthy (HTTP 200 + fb_trace_id on every
--   send). Marketing read "no events" as "CAPI broken."
--
-- Routing:
--   The edge function (meta-capi-events) falls back to brand=nimt when
--   leads.portal_brand is NULL, which matches reality for non-portal intake
--   today (Meta nimt page, JustDial NIMT, manual NIMT entries). Brand-aware
--   ingest paths (PR follow-up) will set portal_brand explicitly for Mirai/
--   Beacon lead forms.
--
-- Dedup with browser-side fires is unchanged: event_id is still
-- `lead_<uuid>`, Meta dedupes inside ~7d on (pixel_id, Lead, event_id).

CREATE OR REPLACE FUNCTION public.fn_capi_emit_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_capi_relay_post(
    NEW.id,
    'Lead',
    'lead_' || NEW.id::text,
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;
