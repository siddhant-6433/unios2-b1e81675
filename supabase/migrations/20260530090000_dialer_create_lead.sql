-- Cloud Dialer: create a new lead via a SECURITY DEFINER RPC.
--
-- Root cause this fixes: the dialer created leads with a client-side
-- supabase.from('leads').insert(...).select('id'). The trailing .select()
-- makes PostgREST issue INSERT ... RETURNING, which requires the new row to
-- pass the SELECT RLS policy too. That policy is
--   has_role(...) OR can_view_lead(uid, id)
-- and can_view_lead() re-queries the leads table by id. For a non-admin
-- counsellor the row being inserted isn't visible to that nested query
-- mid-statement, so can_view_lead returns false and the INSERT fails with
-- 42501 "new row violates row-level security policy". Admins are unaffected
-- (the has_role branch short-circuits before the leads re-query).
--
-- Rather than change the shared SELECT policy / can_view_lead (high blast
-- radius across counsellor/applicant/alumni flows), the dialer creates leads
-- through this definer RPC. The counsellor is derived from auth.uid(); an
-- existing phone is never taken over — the caller is attached as a 'secondary'
-- counsellor instead (same as dialer_claim_existing_lead).

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
  v_digits text;
  v_norm   text;
  v_existing uuid;
  v_existing_owner uuid;
  v_id     uuid;
  v_lead   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_prof FROM profiles WHERE user_id = v_uid;
  IF v_prof IS NULL THEN RAISE EXCEPTION 'No profile for current user'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF COALESCE(btrim(_name), '') = '' THEN RAISE EXCEPTION 'Name required'; END IF;

  v_digits := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF length(v_digits) < 10 THEN RAISE EXCEPTION 'Valid phone required'; END IF;
  v_norm := '+91' || right(v_digits, 10);

  -- Existing non-mirror lead for this phone? Don't duplicate, don't take over —
  -- attach the caller as a secondary counsellor and return it.
  SELECT id, counsellor_id INTO v_existing, v_existing_owner
  FROM leads WHERE phone = v_norm AND is_mirror = false
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF v_existing_owner IS DISTINCT FROM v_prof THEN
      INSERT INTO lead_counsellors (lead_id, counsellor_id, role, added_by)
      VALUES (v_existing, v_prof, 'secondary', v_prof)
      ON CONFLICT (lead_id, counsellor_id) DO NOTHING;
    END IF;
    v_id := v_existing;
  ELSE
    INSERT INTO leads (name, phone, stage, source, counsellor_id)
    VALUES (btrim(_name), v_norm, 'new_lead', 'dialer', v_prof)
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

REVOKE ALL ON FUNCTION public.dialer_create_lead(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dialer_create_lead(text, text) TO authenticated;
