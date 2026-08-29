-- Tag lead lists (city + type) so the lists dashboard can be searched by tag,
-- and add a bulk-import RPC for loading society/contact spreadsheets as lead
-- lists without firing AI calls / WhatsApp (skip_ai_call = true on every row).
--
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE).

-- ── 1. tags[] on lead_lists + GIN index for tag search ─────────────────
ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_lead_lists_tags
  ON public.lead_lists USING gin (tags);

-- ── 2. Bulk import RPC ─────────────────────────────────────────────────
-- Upserts marketing contacts into `leads` (merge on normalized phone, per the
-- global partial unique index idx_leads_phone_unique), sets city, forces
-- skip_ai_call = true (suppresses trg_auto_ai_call_on_lead_create), and links
-- every resulting lead into _list_id via lead_list_members.
--
-- _rows: jsonb array of { name, phone, email, city }.
-- Returns { inserted_or_updated int, linked int }.
CREATE OR REPLACE FUNCTION public.import_leads_bulk(
  _list_id uuid,
  _rows    jsonb,
  _source  public.lead_source DEFAULT 'other'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'  -- big jsonb batches exceed the default API timeout
AS $$
DECLARE
  v_affected int;
  v_linked   int;
BEGIN
  -- Normalize + dedupe within the payload (DISTINCT ON avoids the
  -- "ON CONFLICT DO UPDATE cannot affect row a second time" error).
  WITH raw AS (
    SELECT
      NULLIF(btrim(r->>'name'), '')                     AS name,
      public.normalize_lead_phone(r->>'phone')          AS phone,
      NULLIF(btrim(r->>'email'), '')                    AS email,
      NULLIF(btrim(r->>'city'), '')                     AS city
    FROM jsonb_array_elements(_rows) AS r
  ),
  valid AS (
    SELECT DISTINCT ON (phone) name, phone, email, city
    FROM raw
    WHERE phone <> ''
  ),
  upserted AS (
    INSERT INTO public.leads (name, phone, email, city, source, skip_ai_call)
    SELECT COALESCE(name, 'Unknown'), phone, email, city, _source, true
    FROM valid
    ON CONFLICT (phone) WHERE phone IS NOT NULL AND is_mirror = false
    DO UPDATE SET
      city       = COALESCE(public.leads.city, EXCLUDED.city),
      email      = COALESCE(public.leads.email, EXCLUDED.email),
      updated_at = now()
    RETURNING id
  ),
  ins_affected AS (
    SELECT count(*)::int AS n FROM upserted
  ),
  linked AS (
    INSERT INTO public.lead_list_members (list_id, lead_id)
    SELECT _list_id, id FROM upserted
    ON CONFLICT DO NOTHING
    RETURNING lead_id
  )
  SELECT (SELECT n FROM ins_affected), (SELECT count(*)::int FROM linked)
  INTO v_affected, v_linked;

  RETURN jsonb_build_object('inserted_or_updated', v_affected, 'linked', v_linked);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_leads_bulk(uuid, jsonb, public.lead_source) TO service_role;

-- ── 3. Missing FK indexes on leads' children ───────────────────────────
-- These tables reference leads(id) with no index on lead_id, so any DELETE on
-- a lead did a seq-scan per row (crippling bulk cleanup). Also generally
-- beneficial for lead-scoped reads. Idempotent.
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbound_context_lead_id  ON public.whatsapp_outbound_context(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_campaign_recipients_lead_id ON public.whatsapp_campaign_recipients(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_lead_id     ON public.whatsapp_inbound_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_state_lead_id ON public.whatsapp_conversation_state(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_buffers_lead_id    ON public.whatsapp_message_buffers(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sla_alerts_lead_id         ON public.whatsapp_sla_alerts(lead_id);
CREATE INDEX IF NOT EXISTS idx_students_lead_id                    ON public.students(lead_id);
