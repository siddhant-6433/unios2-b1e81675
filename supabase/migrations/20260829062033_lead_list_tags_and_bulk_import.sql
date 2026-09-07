-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260829062033 name=lead_list_tags_and_bulk_import applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Tag lead lists (city + type) + bulk-import RPC (no AI calls: skip_ai_call=true).
ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_lead_lists_tags
  ON public.lead_lists USING gin (tags);

CREATE OR REPLACE FUNCTION public.import_leads_bulk(
  _list_id uuid,
  _rows    jsonb,
  _source  public.lead_source DEFAULT 'other'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected int;
  v_linked   int;
BEGIN
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
