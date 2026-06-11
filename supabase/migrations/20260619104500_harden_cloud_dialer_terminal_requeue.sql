-- Harden Cloud Dialer against terminal leads re-entering via direct dial,
-- stale pins, list queues, or follow-up creation.
--
-- Earlier fixes removed terminal stages from the smart queue. Counsellors can
-- still hit closed leads through secondary paths: dial-by-number RPCs, existing
-- cloud_dialer_pins, and the non-smart fresh/all queue RPC. Keep deferred out
-- of this set by design; it is followable next session.

CREATE OR REPLACE FUNCTION public.is_terminal_dialer_stage(p_stage text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_stage, '') IN (
    'not_interested',
    'dnc',
    'rejected',
    'ineligible',
    'admitted',
    'cold'
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_cancel_followups_on_terminal_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_terminal_dialer_stage(NEW.stage::text)
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    UPDATE public.lead_followups
    SET status = 'cancelled',
        completed_at = now()
    WHERE lead_id = NEW.id
      AND status = 'pending';

    DELETE FROM public.cloud_dialer_pins
    WHERE lead_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_followups_terminal_stage ON public.leads;
CREATE TRIGGER trg_cancel_followups_terminal_stage
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (public.is_terminal_dialer_stage(NEW.stage::text))
  EXECUTE FUNCTION public.fn_cancel_followups_on_terminal_stage();

CREATE OR REPLACE FUNCTION public.fn_reject_terminal_cloud_dialer_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id = NEW.lead_id
      AND public.is_terminal_dialer_stage(l.stage::text)
  ) THEN
    RAISE EXCEPTION 'Cannot pin terminal lead for Cloud Dialer';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_terminal_cloud_dialer_pin ON public.cloud_dialer_pins;
CREATE TRIGGER trg_reject_terminal_cloud_dialer_pin
  BEFORE INSERT OR UPDATE OF lead_id ON public.cloud_dialer_pins
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reject_terminal_cloud_dialer_pin();

UPDATE public.lead_followups lf
SET status = 'cancelled',
    completed_at = COALESCE(lf.completed_at, now())
FROM public.leads l
WHERE lf.lead_id = l.id
  AND lf.status = 'pending'
  AND public.is_terminal_dialer_stage(l.stage::text);

DELETE FROM public.cloud_dialer_pins p
USING public.leads l
WHERE p.lead_id = l.id
  AND public.is_terminal_dialer_stage(l.stage::text);

CREATE OR REPLACE FUNCTION public.cloud_dialer_list_queue(
  p_counsellor_id uuid DEFAULT NULL,
  p_mode text DEFAULT 'fresh',
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  selected AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.stage,
      l.source,
      l.course_id,
      l.created_at
    FROM public.leads l
    WHERE l.phone IS NOT NULL
      AND NOT public.is_terminal_dialer_stage(l.stage::text)
      AND (
        (p_mode = 'fresh' AND l.stage = 'new_lead')
        OR
        (p_mode = 'all' AND l.stage IN ('priority_interested', 'new_lead', 'counsellor_call', 'application_in_progress'))
      )
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.created_at ASC
    LIMIT p_limit
  ),
  enriched AS (
    SELECT
      s.id,
      s.name,
      s.phone,
      s.stage,
      COALESCE(s.source::text, '') AS source,
      s.course_id,
      COALESCE(c.name, '—') AS course_name,
      c.fee_per_year AS course_fee_per_year,
      COALESCE(cmp.name, '—') AS campus_name,
      CASE
        WHEN p_mode = 'fresh' THEN 'New Lead'
        ELSE CASE s.stage
          WHEN 'priority_interested' THEN 'Priority Interested'
          WHEN 'new_lead' THEN 'New Lead'
          WHEN 'counsellor_call' THEN 'Follow Up'
          WHEN 'application_in_progress' THEN 'App In Progress'
          WHEN 'visit_scheduled' THEN 'Visit Scheduled'
          WHEN 'application_fee_paid' THEN 'Fee Paid'
          ELSE s.stage::text
        END
      END AS bucket,
      CASE
        WHEN p_mode = 'fresh' THEN 7
        ELSE CASE s.stage
          WHEN 'priority_interested' THEN 1
          WHEN 'new_lead' THEN 2
          WHEN 'counsellor_call' THEN 3
          WHEN 'application_in_progress' THEN 4
          ELSE 99
        END
      END AS bucket_priority,
      0::int AS attempt_count,
      s.created_at
    FROM selected s
    LEFT JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN public.campuses cmp ON cmp.id = (
      SELECT i.campus_id
      FROM public.departments d
      JOIN public.institutions i ON i.id = d.institution_id
      WHERE d.id = c.department_id
      LIMIT 1
    )
  ),
  queue_count AS (
    SELECT count(*)::int AS total
    FROM enriched
  )
SELECT jsonb_build_object(
  'queue', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) - 'created_at' ORDER BY e.created_at ASC, e.id ASC) FROM enriched e),
    '[]'::jsonb
  ),
  'buckets', COALESCE(
    (
      SELECT CASE
        WHEN qc.total > 0 THEN jsonb_build_array(jsonb_build_object(
          'bucket_priority', CASE WHEN p_mode = 'fresh' THEN 7 ELSE 99 END,
          'label', CASE WHEN p_mode = 'fresh' THEN 'New Leads' ELSE 'All Pipeline' END,
          'count', qc.total
        ))
        ELSE '[]'::jsonb
      END
      FROM queue_count qc
    ),
    '[]'::jsonb
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.cloud_dialer_list_queue(uuid, text, integer) TO authenticated;

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
    'primary_name', COALESCE(v_primary_name, 'another counsellor'),
    'is_terminal',  public.is_terminal_dialer_stage(v_lead.stage)
  );
END $$;

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
  IF public.is_terminal_dialer_stage(v_lead.stage) THEN
    RAISE EXCEPTION 'Lead is closed and cannot be called from Cloud Dialer';
  END IF;

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
  v_existing_stage text;
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

  SELECT id, counsellor_id, stage::text
    INTO v_existing, v_existing_owner, v_existing_stage
  FROM leads
  WHERE phone = v_norm AND is_mirror = false
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF public.is_terminal_dialer_stage(v_existing_stage) THEN
      RAISE EXCEPTION 'Lead is closed and cannot be called from Cloud Dialer';
    END IF;

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

REVOKE ALL ON FUNCTION public.dialer_find_lead_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dialer_claim_existing_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dialer_create_lead(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dialer_find_lead_by_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_claim_existing_lead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_create_lead(text, text) TO authenticated;
