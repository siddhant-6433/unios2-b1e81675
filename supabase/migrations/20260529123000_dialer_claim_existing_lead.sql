-- Cloud Dialer: handle "Create & Call" on a number that already exists.
--
-- Problem: the dialer's phone lookup runs under the counsellor's RLS scope, so
-- a lead owned by ANOTHER counsellor is invisible. The UI then offers "add new",
-- and the insert hits the global partial unique index idx_leads_phone_unique
-- (phone WHERE NOT is_mirror) → 23505, leaving the counsellor stuck: they can
-- neither see the lead to call it nor create it.
--
-- Fix: two SECURITY DEFINER helpers so the dialer can find an existing lead
-- across RLS and let the dialing counsellor call it WITHOUT taking it over.
-- The dialing counsellor is recorded in lead_counsellors as a 'secondary'
-- counsellor (the existing secondary-counsellor mechanism that can_view_lead
-- already honours), so the primary counsellor keeps ownership and the dialer
-- gains visibility. No RLS policy is changed.

-- Read-only lookup. Returns the existing non-mirror lead for a phone (or NULL),
-- regardless of who owns it. Gated to authenticated staff (profile + a role),
-- mirroring the "Staff can insert leads" / "Staff can view leads" gates.
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
  v_digits text;
  v_norm   text;
  v_lead   record;
  v_primary_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_prof FROM profiles WHERE user_id = v_uid;
  IF v_prof IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid) THEN RETURN NULL; END IF;

  -- Normalise the same way normalize_lead_phone() stores it: +91 + last 10.
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

-- Attach the calling counsellor as a SECONDARY counsellor on an existing lead
-- (idempotent; skipped if they are already the primary) and return the lead's
-- call-relevant fields. The counsellor is derived strictly from auth.uid() —
-- a caller can only ever attach themselves.
CREATE OR REPLACE FUNCTION public.dialer_claim_existing_lead(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_prof uuid;
  v_lead record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_prof FROM profiles WHERE user_id = v_uid;
  IF v_prof IS NULL THEN RAISE EXCEPTION 'No profile for current user'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT l.id, l.name, l.phone, l.stage::text AS stage, l.source::text AS source,
         l.course_id, l.counsellor_id,
         COALESCE(c.name, '—')   AS course_name,
         COALESCE(cmp.name, '—') AS campus_name
    INTO v_lead
  FROM leads l
  LEFT JOIN courses c    ON c.id = l.course_id
  LEFT JOIN campuses cmp ON cmp.id = l.campus_id
  WHERE l.id = _lead_id
  LIMIT 1;

  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;

  IF v_lead.counsellor_id IS DISTINCT FROM v_prof THEN
    INSERT INTO lead_counsellors (lead_id, counsellor_id, role, added_by)
    VALUES (_lead_id, v_prof, 'secondary', v_prof)
    ON CONFLICT (lead_id, counsellor_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'id',          v_lead.id,
    'name',        v_lead.name,
    'phone',       v_lead.phone,
    'stage',       v_lead.stage,
    'source',      v_lead.source,
    'course_id',   v_lead.course_id,
    'course_name', v_lead.course_name,
    'campus_name', v_lead.campus_name
  );
END $$;

REVOKE ALL ON FUNCTION public.dialer_find_lead_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dialer_claim_existing_lead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dialer_find_lead_by_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_claim_existing_lead(uuid) TO authenticated;
