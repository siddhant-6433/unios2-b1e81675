-- Promotion: a marketing contact becomes a real lead only when it ENGAGES.
--
-- Companion to 20260830053655_marketing_contacts_table.sql. Three RPCs:
--   promote_marketing_contact       — the promotion itself (idempotent)
--   resolve_or_create_lead_by_phone — the single find-or-create primitive that
--                                     replaces five duplicated implementations
--   import_marketing_contacts_bulk  — imports now land in marketing_contacts
--
-- Idempotent: safe to re-run.

-- ── 1. promote_marketing_contact ───────────────────────────────────────
-- Returns the lead id. Safe to call concurrently and repeatedly: the contact
-- row is locked FOR UPDATE and an already-promoted contact short-circuits.
--
-- Deliberately sets skip_ai_call = true. trg_auto_ai_call_on_lead_create
-- (20260514110000) fires voice-call + automation-engine on every leads INSERT;
-- promotion is triggered BY an engagement channel that is already a live
-- conversation, so robo-calling the person mid-chat would be absurd.
CREATE OR REPLACE FUNCTION public.promote_marketing_contact(
  _contact_id uuid,
  _source     public.lead_source DEFAULT 'other',
  _reason     text DEFAULT 'engaged'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            public.marketing_contacts%ROWTYPE;
  v_lead_id    uuid;
  v_normalized text;
BEGIN
  -- SECURITY DEFINER bypasses the marketing_contacts RLS policies, so
  -- re-assert them here. auth.uid() IS NULL means a service-role/edge caller.
  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to promote marketing contacts';
  END IF;

  SELECT * INTO c FROM public.marketing_contacts WHERE id = _contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Already promoted (or promoted by a concurrent caller that got here first).
  IF c.promoted_lead_id IS NOT NULL THEN
    RETURN c.promoted_lead_id;
  END IF;

  v_normalized := public.normalize_lead_phone(c.phone);

  -- A real lead may already exist on this number (the contact was imported
  -- after the lead, or the import's collision link was missed). Link, never
  -- duplicate — idx_leads_phone_unique would reject the insert anyway.
  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE is_mirror = false
     AND public.normalize_lead_phone(phone) = v_normalized
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    -- Reuse the contact's uuid as the lead's id. Makes promotion the exact
    -- inverse of the cutover migration, so rollback is a straight re-insert.
    INSERT INTO public.leads (id, name, phone, email, city, area, state,
                              source, stage, skip_ai_call)
    VALUES (c.id,
            COALESCE(NULLIF(btrim(c.name), ''), c.phone),
            c.phone, c.email, c.city, c.area, c.state,
            _source, 'new_lead', true)
    RETURNING id INTO v_lead_id;

    -- Existing intake primitive (20260620100000_intake_round_robin_pool.sql).
    -- Returns NULL when no intake pool is configured, which leaves the lead in
    -- unassigned_leads_bucket exactly as an unowned lead behaves today.
    PERFORM public.fn_intake_round_robin_assign(v_lead_id);
  END IF;

  UPDATE public.marketing_contacts
     SET promoted_lead_id = v_lead_id,
         promoted_at      = now(),
         promotion_reason = _reason,
         updated_at       = now()
   WHERE id = _contact_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (v_lead_id, 'system',
          'Promoted from marketing contact (' || _reason || ')');

  INSERT INTO public.lead_engagement_events (lead_id, phone, event_type, metadata)
  VALUES (v_lead_id, c.phone, 'contact_promoted',
          jsonb_build_object('contact_id', c.id, 'reason', _reason));

  RETURN v_lead_id;
END;
$$;

-- ── 2. resolve_or_create_lead_by_phone ─────────────────────────────────
-- The one find-or-create primitive. Before this, the same lookup+insert was
-- reimplemented in five places (whatsapp-webhook, whatsapp-ai-reply,
-- whatsapp-plivo-webhook, voice-agent/server.ts, web-chat-server/server.ts)
-- and had already drifted: only two of the five called the intake round-robin,
-- so Plivo-created leads stayed permanently unowned.
--
-- Order matters: existing lead → marketing contact (promote) → new lead.
CREATE OR REPLACE FUNCTION public.resolve_or_create_lead_by_phone(
  _phone  text,
  _source public.lead_source DEFAULT 'other',
  _reason text DEFAULT 'inbound',
  _name   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text := public.normalize_lead_phone(_phone);
  v_lead_id    uuid;
  v_contact_id uuid;
BEGIN
  -- SECURITY DEFINER bypasses the marketing_contacts RLS policies, so
  -- re-assert them here. auth.uid() IS NULL means a service-role/edge caller.
  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to resolve leads by phone';
  END IF;

  IF v_normalized IS NULL OR v_normalized = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE is_mirror = false
     AND public.normalize_lead_phone(phone) = v_normalized
   LIMIT 1;
  IF v_lead_id IS NOT NULL THEN
    RETURN v_lead_id;
  END IF;

  SELECT id INTO v_contact_id
    FROM public.marketing_contacts
   WHERE public.normalize_lead_phone(phone) = v_normalized
   LIMIT 1;
  IF v_contact_id IS NOT NULL THEN
    RETURN public.promote_marketing_contact(v_contact_id, _source, _reason);
  END IF;

  -- Genuinely new person. Matches the old inline behaviour, including
  -- naming the lead after the phone number when no name is known.
  INSERT INTO public.leads (name, phone, source, stage, skip_ai_call)
  VALUES (COALESCE(NULLIF(btrim(_name), ''), _phone), _phone, _source, 'new_lead', true)
  RETURNING id INTO v_lead_id;

  PERFORM public.fn_intake_round_robin_assign(v_lead_id);
  RETURN v_lead_id;
END;
$$;

-- ── 3. import_marketing_contacts_bulk ──────────────────────────────────
-- Replaces import_leads_bulk. Same CTE shape (normalize → DISTINCT ON to dodge
-- "ON CONFLICT DO UPDATE cannot affect row a second time" → upsert → link),
-- but writes to marketing_contacts and never touches `leads`.
--
-- Collision rule: if the number is ALREADY a real lead, the contact is created
-- with promoted_lead_id pre-set. It still joins the list (so campaign reach is
-- unchanged) but campaign send renders from the lead, so nobody gets messaged
-- twice and no duplicate person is created.
CREATE OR REPLACE FUNCTION public.import_marketing_contacts_bulk(
  _list_id uuid,
  _rows    jsonb,
  _source  text DEFAULT 'import'
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
  -- The in-app importer runs under a staff JWT, so this is granted to
  -- `authenticated` too. SECURITY DEFINER bypasses RLS, so re-assert the
  -- marketing_contacts write policy here.
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
$$;

-- ── 4. lead_list_members_page ──────────────────────────────────────────
-- One paged view over a list's members regardless of kind, so LeadLists.tsx
-- doesn't need two queries and a client-side merge. SECURITY DEFINER because
-- lead-backed rows would otherwise be filtered per-row by can_view_lead — the
-- same pattern (and the same reason) as the cloud dialer queue fix in
-- 20260824114338.
CREATE OR REPLACE FUNCTION public.lead_list_members_page(
  _list_id uuid,
  _limit   int DEFAULT 100,
  _offset  int DEFAULT 0,
  _q       text DEFAULT NULL
) RETURNS TABLE (
  member_id  uuid,
  kind       text,
  target_id  uuid,
  name       text,
  phone      text,
  email      text,
  city       text,
  stage      text,
  promoted   boolean,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mrows AS (
    SELECT m.id AS member_id,
           CASE WHEN m.lead_id IS NOT NULL THEN 'lead' ELSE 'contact' END AS kind,
           COALESCE(m.lead_id, m.contact_id) AS target_id,
           COALESCE(l.name, c.name)          AS name,
           COALESCE(l.phone, c.phone)        AS phone,
           COALESCE(l.email, c.email)        AS email,
           COALESCE(l.city, c.city)          AS city,
           l.stage::text                     AS stage,
           (c.promoted_lead_id IS NOT NULL)  AS promoted
      FROM public.lead_list_members m
      LEFT JOIN public.leads               l ON l.id = m.lead_id
      LEFT JOIN public.marketing_contacts  c ON c.id = m.contact_id
     WHERE m.list_id = _list_id
       AND (
         _q IS NULL OR btrim(_q) = ''
         OR COALESCE(l.name, c.name)   ILIKE '%' || _q || '%'
         OR COALESCE(l.phone, c.phone) ILIKE '%' || _q || '%'
       )
  )
  SELECT r.*, (SELECT count(*) FROM mrows) AS total_count
    FROM mrows r
   ORDER BY r.name NULLS LAST
   LIMIT _limit OFFSET _offset;
$$;

-- ── 5. Grants + retire the old import path ─────────────────────────────
GRANT EXECUTE ON FUNCTION public.promote_marketing_contact(uuid, public.lead_source, text)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_lead_by_phone(text, public.lead_source, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_marketing_contacts_bulk(uuid, jsonb, text)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_list_members_page(uuid, int, int, text)                          TO authenticated, service_role;

-- import_leads_bulk wrote marketing data straight into `leads` — the exact
-- coupling this change removes. It is created by 20260829145145, which sorts
-- earlier, so on a fresh database the create-then-drop sequence is correct.
-- IF EXISTS keeps this safe on databases that never had it.
DROP FUNCTION IF EXISTS public.import_leads_bulk(uuid, jsonb, public.lead_source);
