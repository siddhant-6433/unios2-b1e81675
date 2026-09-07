-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260829153707 name=import_marketing_contacts_bulk_authenticated_grant applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- The in-app bulk importer (BulkLeadImportDialog) runs under a staff JWT, not
-- the service role, so the RPC needs an authenticated grant. SECURITY DEFINER
-- bypasses RLS, so the role check that the marketing_contacts write policy
-- would have applied is re-asserted inside the function instead.
CREATE OR REPLACE FUNCTION public.import_marketing_contacts_bulk(
  _list_id uuid,
  _rows    jsonb,
  _source  text DEFAULT 'import'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $fn$
DECLARE
  v_affected int;
  v_linked   int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'data_entry'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to import marketing contacts';
  END IF;

  WITH raw AS (
    SELECT
      NULLIF(btrim(r->>'name'), '')            AS name,
      public.normalize_lead_phone(r->>'phone') AS phone,
      NULLIF(btrim(r->>'email'), '')           AS email,
      NULLIF(btrim(r->>'city'), '')            AS city,
      NULLIF(btrim(r->>'area'), '')            AS area,
      NULLIF(btrim(r->>'state'), '')           AS state
    FROM jsonb_array_elements(_rows) AS r
  ),
  valid AS (
    SELECT DISTINCT ON (phone) name, phone, email, city, area, state
    FROM raw
    WHERE phone IS NOT NULL AND phone <> ''
  ),
  upserted AS (
    INSERT INTO public.marketing_contacts
      (name, phone, email, city, area, state, source, promoted_lead_id, promoted_at, promotion_reason)
    SELECT v.name, v.phone, v.email, v.city, v.area, v.state, _source,
           l.id,
           CASE WHEN l.id IS NOT NULL THEN now() END,
           CASE WHEN l.id IS NOT NULL THEN 'already_a_lead' END
      FROM valid v
      LEFT JOIN LATERAL (
        SELECT id FROM public.leads
         WHERE is_mirror = false
           AND public.normalize_lead_phone(phone) = v.phone
         LIMIT 1
      ) l ON true
    ON CONFLICT (public.normalize_lead_phone(phone))
    DO UPDATE SET
      city       = COALESCE(public.marketing_contacts.city, EXCLUDED.city),
      email      = COALESCE(public.marketing_contacts.email, EXCLUDED.email),
      area       = COALESCE(public.marketing_contacts.area, EXCLUDED.area),
      state      = COALESCE(public.marketing_contacts.state, EXCLUDED.state),
      updated_at = now()
    RETURNING id
  ),
  ins_affected AS (
    SELECT count(*)::int AS n FROM upserted
  ),
  linked AS (
    INSERT INTO public.lead_list_members (list_id, contact_id)
    SELECT _list_id, id FROM upserted
    ON CONFLICT DO NOTHING
    RETURNING contact_id
  )
  SELECT (SELECT n FROM ins_affected), (SELECT count(*)::int FROM linked)
  INTO v_affected, v_linked;

  RETURN jsonb_build_object('inserted_or_updated', v_affected, 'linked', v_linked);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.import_marketing_contacts_bulk(uuid, jsonb, text) TO authenticated, service_role;
