-- Stop auto-cloning Beacon/NIMT school leads onto Mirai (and the reverse).
-- The two schools are separate CRM pipelines: the same phone may exist once
-- as a NIMT/Beacon lead and once as a Mirai school lead.
--
-- Leftover is_mirror clones are promoted into real same-brand rows when that
-- would not collide, then unlinked. Empty duplicate clones stay hidden.

CREATE OR REPLACE FUNCTION public.school_lead_brand(
  p_portal_brand text,
  p_campus_id uuid,
  p_institution_type text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_portal_brand, '')) = 'mirai' THEN 'mirai'
    WHEN p_campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid
     AND coalesce(p_institution_type, '') = 'school' THEN 'mirai'
    ELSE 'nimt'
  END
$$;

-- ── 1. Never create another Beacon↔Mirai clone ───────────────────────────

DROP TRIGGER IF EXISTS trg_mirror_school_lead ON public.leads;

CREATE OR REPLACE FUNCTION public.fn_mirror_school_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- ── 2. Allow one real lead per phone per school brand ────────────────────

DROP INDEX IF EXISTS public.idx_leads_phone_unique;

-- Tag leftover Mirai school rows so brand matching does not depend on campus.
UPDATE public.leads
   SET portal_brand = 'mirai'
 WHERE lead_institution_type = 'school'
   AND campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid
   AND portal_brand IS DISTINCT FROM 'mirai';

-- Promote one leftover clone per (phone, brand) when no real row exists yet.
UPDATE public.leads m
   SET is_mirror = false
  FROM (
    SELECT DISTINCT ON (
      phone,
      public.school_lead_brand(portal_brand, campus_id, lead_institution_type)
    ) id
      FROM public.leads
     WHERE is_mirror = true
       AND phone IS NOT NULL
     ORDER BY
       phone,
       public.school_lead_brand(portal_brand, campus_id, lead_institution_type),
       CASE WHEN counsellor_id IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN application_id IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN admission_no IS NOT NULL THEN 0 ELSE 1 END,
       created_at ASC
  ) pick
 WHERE m.id = pick.id
   AND NOT EXISTS (
     SELECT 1
       FROM public.leads o
      WHERE o.id <> m.id
        AND o.is_mirror = false
        AND o.phone IS NOT DISTINCT FROM m.phone
        AND public.school_lead_brand(o.portal_brand, o.campus_id, o.lead_institution_type)
          = public.school_lead_brand(m.portal_brand, m.campus_id, m.lead_institution_type)
   );

UPDATE public.leads
   SET mirror_lead_id = NULL
 WHERE mirror_lead_id IS NOT NULL;

CREATE UNIQUE INDEX idx_leads_phone_unique_nimt
  ON public.leads (phone)
  WHERE phone IS NOT NULL
    AND is_mirror = false
    AND public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = 'nimt';

CREATE UNIQUE INDEX idx_leads_phone_unique_mirai
  ON public.leads (phone)
  WHERE phone IS NOT NULL
    AND is_mirror = false
    AND public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = 'mirai';

-- ── 3. Manual add / bulk import / WhatsApp find-or-create stay on-brand ─

CREATE OR REPLACE FUNCTION public.insert_lead(
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _guardian_name text DEFAULT NULL,
  _guardian_phone text DEFAULT NULL,
  _source text DEFAULT 'website',
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _counsellor_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _consultant_id uuid DEFAULT NULL,
  _cnet_appeared boolean DEFAULT NULL,
  _cahet_registered boolean DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_phone text;
  v_brand text;
BEGIN
  v_phone := public.normalize_lead_phone(_phone);
  v_brand := public.school_lead_brand(
    NULL,
    _campus_id,
    public.compute_lead_institution_type(_course_id, _campus_id, NULL)
  );

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE public.normalize_lead_phone(phone) = v_phone
     AND is_mirror = false
     AND public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = v_brand
   LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads SET
      name = COALESCE(NULLIF(_name, ''), name),
      email = COALESCE(NULLIF(_email, ''), email),
      guardian_name = COALESCE(NULLIF(_guardian_name, ''), guardian_name),
      guardian_phone = COALESCE(NULLIF(_guardian_phone, ''), guardian_phone),
      course_id = COALESCE(_course_id, course_id),
      campus_id = COALESCE(_campus_id, campus_id),
      counsellor_id = COALESCE(_counsellor_id, counsellor_id),
      cnet_appeared = COALESCE(_cnet_appeared, cnet_appeared),
      cahet_registered = COALESCE(_cahet_registered, cahet_registered),
      updated_at = now()
    WHERE id = v_lead_id;
    RETURN v_lead_id;
  END IF;

  INSERT INTO public.leads (
    name, phone, email, guardian_name, guardian_phone,
    source, course_id, campus_id, counsellor_id, consultant_id,
    cnet_appeared, cahet_registered, skip_ai_call, stage
  )
  VALUES (
    _name, v_phone, NULLIF(_email, ''),
    NULLIF(_guardian_name, ''), NULLIF(_guardian_phone, ''),
    _source::lead_source,
    _course_id, _campus_id, _counsellor_id, _consultant_id,
    _cnet_appeared, _cahet_registered, true,
    'new_lead'::lead_stage
  )
  RETURNING id INTO v_lead_id;

  IF _notes IS NOT NULL AND _notes != '' THEN
    INSERT INTO public.lead_notes (lead_id, content) VALUES (v_lead_id, _notes);
  END IF;

  RETURN v_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_lead TO authenticated;

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
  existing AS (
    SELECT DISTINCT ON (public.normalize_lead_phone(l.phone))
           l.id, public.normalize_lead_phone(l.phone) AS phone
      FROM public.leads l
      JOIN valid v ON public.normalize_lead_phone(l.phone) = v.phone
     WHERE l.is_mirror = false
       AND public.school_lead_brand(l.portal_brand, l.campus_id, l.lead_institution_type) = 'nimt'
     ORDER BY public.normalize_lead_phone(l.phone), l.created_at ASC
  ),
  updated AS (
    UPDATE public.leads l
       SET city       = COALESCE(l.city, v.city),
           email      = COALESCE(l.email, v.email),
           updated_at = now()
      FROM valid v
      JOIN existing e ON e.phone = v.phone
     WHERE l.id = e.id
    RETURNING l.id
  ),
  inserted AS (
    INSERT INTO public.leads (name, phone, email, city, source, skip_ai_call)
    SELECT COALESCE(v.name, 'Unknown'), v.phone, v.email, v.city, _source, true
      FROM valid v
      LEFT JOIN existing e ON e.phone = v.phone
     WHERE e.id IS NULL
    RETURNING id
  ),
  upserted AS (
    SELECT id FROM updated
    UNION ALL
    SELECT id FROM inserted
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

DROP FUNCTION IF EXISTS public.resolve_or_create_lead_by_phone(text, public.lead_source, text, text);

CREATE FUNCTION public.resolve_or_create_lead_by_phone(
  _phone  text,
  _source public.lead_source DEFAULT 'other',
  _reason text DEFAULT 'inbound',
  _name   text DEFAULT NULL,
  _portal_brand text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_normalized text := public.normalize_lead_phone(_phone);
  v_lead_id    uuid;
  v_contact_id uuid;
  v_brand      text := public.school_lead_brand(_portal_brand, NULL, NULL);
  MIRAI_CAMPUS constant uuid := 'c0000002-0000-0000-0000-000000000001';
BEGIN
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
     AND public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = v_brand
   LIMIT 1;
  IF v_lead_id IS NOT NULL THEN
    RETURN v_lead_id;
  END IF;

  -- Marketing contacts live on the NIMT pipeline. Do not promote them onto
  -- a Mirai school enquiry — mint a Mirai lead instead.
  IF v_brand IS DISTINCT FROM 'mirai' THEN
    SELECT id INTO v_contact_id
      FROM public.marketing_contacts
     WHERE public.normalize_lead_phone(phone) = v_normalized
     LIMIT 1;
    IF v_contact_id IS NOT NULL THEN
      RETURN public.promote_marketing_contact(v_contact_id, _source, _reason);
    END IF;
  END IF;

  INSERT INTO public.leads (name, phone, source, stage, skip_ai_call, portal_brand, campus_id)
  VALUES (
    COALESCE(NULLIF(btrim(_name), ''), _phone),
    _phone,
    _source,
    'new_lead',
    true,
    CASE WHEN v_brand = 'mirai' THEN 'mirai' ELSE _portal_brand END,
    CASE WHEN v_brand = 'mirai' THEN MIRAI_CAMPUS ELSE NULL END
  )
  RETURNING id INTO v_lead_id;

  PERFORM public.fn_intake_round_robin_assign(v_lead_id);
  RETURN v_lead_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.resolve_or_create_lead_by_phone(text, public.lead_source, text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.promote_marketing_contact(
  _contact_id uuid,
  _source lead_source DEFAULT 'other'::lead_source,
  _reason text DEFAULT 'engaged'::text,
  _counsellor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c            public.marketing_contacts%ROWTYPE;
  v_lead_id    uuid;
  v_normalized text;
BEGIN
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

  IF c.promoted_lead_id IS NOT NULL THEN
    RETURN c.promoted_lead_id;
  END IF;

  v_normalized := public.normalize_lead_phone(c.phone);

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE is_mirror = false
     AND public.normalize_lead_phone(phone) = v_normalized
     AND public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = 'nimt'
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (id, name, phone, email, city, area, state,
                              source, stage, skip_ai_call)
    VALUES (c.id,
            COALESCE(NULLIF(btrim(c.name), ''), c.phone),
            c.phone, c.email, c.city, c.area, c.state,
            _source, 'new_lead', true)
    RETURNING id INTO v_lead_id;

    IF _counsellor_id IS NOT NULL THEN
      UPDATE public.leads
         SET counsellor_id = _counsellor_id, assigned_at = now()
       WHERE id = v_lead_id;
    ELSE
      PERFORM public.fn_intake_round_robin_assign(v_lead_id);
    END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.promote_marketing_contact(uuid, lead_source, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_marketing_contact(uuid, lead_source, text, uuid) TO authenticated, service_role;

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
           AND public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = 'nimt'
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

-- Dialer lookup/create must not attach a Mirai counsellor to a NIMT school lead
-- (or the reverse) now that the same phone can exist in both pipelines.
CREATE OR REPLACE FUNCTION public.dialer_find_lead_by_phone(_phone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_prof   uuid;
  v_campus text;
  v_brand  text;
  v_digits text;
  v_norm   text;
  v_lead   record;
  v_primary_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT id, campus INTO v_prof, v_campus FROM profiles WHERE user_id = v_uid;
  IF v_prof IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid) THEN RETURN NULL; END IF;

  v_brand := CASE WHEN COALESCE(v_campus, '') ILIKE '%mirai%' THEN 'mirai' ELSE 'nimt' END;
  v_digits := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF length(v_digits) < 10 THEN RETURN NULL; END IF;
  v_norm := '+91' || right(v_digits, 10);

  SELECT l.id, l.name, l.phone, l.stage::text AS stage, l.source::text AS source,
         l.course_id, l.counsellor_id,
         COALESCE(c.name, '—')   AS course_name,
         COALESCE(cmp.name, '—') AS campus_name
    INTO v_lead
  FROM leads l
  LEFT JOIN courses c    ON c.id = l.course_id
  LEFT JOIN campuses cmp ON cmp.id = l.campus_id
  WHERE l.phone = v_norm AND l.is_mirror = false
    AND public.school_lead_brand(l.portal_brand, l.campus_id, l.lead_institution_type) = v_brand
  ORDER BY l.created_at DESC
  LIMIT 1;

  IF v_lead.id IS NULL THEN RETURN NULL; END IF;

  SELECT display_name INTO v_primary_name FROM profiles WHERE id = v_lead.counsellor_id;

  RETURN jsonb_build_object(
    'id',           v_lead.id,
    'name',         v_lead.name,
    'phone',        v_lead.phone,
    'stage',        v_lead.stage,
    'source',       v_lead.source,
    'course_id',    v_lead.course_id,
    'course_name',  v_lead.course_name,
    'campus_name',  v_lead.campus_name,
    'is_self',      (v_lead.counsellor_id = v_prof),
    'can_view',     can_view_lead(v_uid, v_lead.id),
    'primary_name', COALESCE(v_primary_name, 'another counsellor')
  );
END $$;

CREATE OR REPLACE FUNCTION public.dialer_create_lead(_name text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_prof   uuid;
  v_campus text;
  v_brand  text;
  v_digits text;
  v_norm   text;
  v_existing uuid;
  v_existing_owner uuid;
  v_id     uuid;
  v_lead   record;
  MIRAI_CAMPUS constant uuid := 'c0000002-0000-0000-0000-000000000001';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, campus INTO v_prof, v_campus FROM profiles WHERE user_id = v_uid;
  IF v_prof IS NULL THEN RAISE EXCEPTION 'No profile for current user'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF COALESCE(btrim(_name), '') = '' THEN RAISE EXCEPTION 'Name required'; END IF;

  v_brand := CASE WHEN COALESCE(v_campus, '') ILIKE '%mirai%' THEN 'mirai' ELSE 'nimt' END;
  v_digits := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF length(v_digits) < 10 THEN RAISE EXCEPTION 'Valid phone required'; END IF;
  v_norm := '+91' || right(v_digits, 10);

  SELECT id, counsellor_id INTO v_existing, v_existing_owner
    FROM leads
   WHERE phone = v_norm AND is_mirror = false
     AND public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = v_brand
   ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF v_existing_owner IS DISTINCT FROM v_prof THEN
      INSERT INTO lead_counsellors (lead_id, counsellor_id, role, added_by)
      VALUES (v_existing, v_prof, 'secondary', v_prof)
      ON CONFLICT (lead_id, counsellor_id) DO NOTHING;
    END IF;
    v_id := v_existing;
  ELSE
    INSERT INTO leads (name, phone, stage, source, counsellor_id, portal_brand, campus_id)
    VALUES (
      btrim(_name), v_norm, 'new_lead', 'dialer', v_prof,
      CASE WHEN v_brand = 'mirai' THEN 'mirai' ELSE NULL END,
      CASE WHEN v_brand = 'mirai' THEN MIRAI_CAMPUS ELSE NULL END
    )
    RETURNING id INTO v_id;
  END IF;

  SELECT l.id, l.name, l.phone, l.stage::text AS stage, l.source::text AS source,
         l.course_id,
         COALESCE(c.name, '—')   AS course_name,
         COALESCE(cmp.name, '—') AS campus_name
    INTO v_lead
  FROM leads l
  LEFT JOIN courses c    ON c.id = l.course_id
  LEFT JOIN campuses cmp ON cmp.id = l.campus_id
  WHERE l.id = v_id;

  RETURN jsonb_build_object(
    'id',          v_lead.id,
    'name',        v_lead.name,
    'phone',       v_lead.phone,
    'stage',       v_lead.stage,
    'source',      v_lead.source,
    'course_id',   v_lead.course_id,
    'course_name', v_lead.course_name,
    'campus_name', v_lead.campus_name,
    'existed',     (v_existing IS NOT NULL)
  );
END $$;

REVOKE ALL ON FUNCTION public.dialer_find_lead_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dialer_create_lead(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dialer_find_lead_by_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_create_lead(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
