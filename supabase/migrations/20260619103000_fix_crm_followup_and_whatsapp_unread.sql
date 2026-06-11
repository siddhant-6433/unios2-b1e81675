-- CRM follow-up and WhatsApp unread fixes.
--
-- 1. Pending/current follow-ups must not include future rows.
-- 2. Follow-up queues must ignore terminal/admitted leads and completed rows.
-- 3. WhatsApp badges should mean "needs a reply", not "old inbound row
--    still has is_read=false even though an outbound reply was sent later".

CREATE OR REPLACE FUNCTION public.whatsapp_conversation_key(
  p_provider text,
  p_business_phone_number_id text,
  p_business_phone_number text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_provider = 'plivo' THEN COALESCE(p_business_phone_number, p_business_phone_number_id, '')
    ELSE COALESCE(p_business_phone_number_id, p_business_phone_number, '')
  END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_conversation_key(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversation_key(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_whatsapp_conversation_read(
  p_phone text,
  p_provider text DEFAULT NULL,
  p_business_phone_number_id text DEFAULT NULL,
  p_business_phone_number text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_provider text := CASE WHEN p_provider IN ('meta', 'plivo') THEN p_provider ELSE NULL END;
  v_key text := public.whatsapp_conversation_key(v_provider, p_business_phone_number_id, p_business_phone_number);
  v_count integer := 0;
BEGIN
  IF v_phone = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.whatsapp_messages wm
     SET is_read = true,
         read_at = COALESCE(wm.read_at, now())
   WHERE wm.phone = v_phone
     AND wm.direction = 'inbound'
     AND wm.is_read = false
     AND (
       v_key = ''
       OR public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) = v_key
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_whatsapp_conversation_read(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_whatsapp_conversation_read(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_unreplied_message_count(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_include_unassigned boolean DEFAULT true
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  auth_scope AS (
    SELECT
      public.get_user_role(auth.uid())::text AS role_name,
      (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1) AS own_profile_id
  ),
  scope AS (
    SELECT
      CASE WHEN role_name = 'counsellor' THEN own_profile_id ELSE p_scope_counsellor_id END AS counsellor_id,
      CASE WHEN role_name = 'counsellor' THEN false ELSE COALESCE(p_include_unassigned, true) END AS include_unassigned
    FROM auth_scope
  )
SELECT COUNT(*)::integer
FROM public.whatsapp_messages wm
LEFT JOIN public.leads l ON l.id = wm.lead_id
CROSS JOIN scope s
WHERE wm.direction = 'inbound'
  AND wm.is_read = false
  AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
  AND (
    s.counsellor_id IS NOT NULL
    OR s.include_unassigned = true
    OR l.counsellor_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_messages replied
    WHERE replied.phone = wm.phone
      AND replied.direction = 'outbound'
      AND replied.created_at > wm.created_at
      AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
        = public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number)
  );
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_unreplied_message_count(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.action_badge_counts(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_include_unassigned boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_overdue integer;
  v_tat_defaults integer;
  v_wa_unread integer;
BEGIN
  v_payload := public.action_badge_counts_base(p_scope_counsellor_id, p_include_unassigned);

  v_wa_unread := public.whatsapp_unreplied_message_count(p_scope_counsellor_id, p_include_unassigned);
  v_payload := jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{wa_unread}', to_jsonb(v_wa_unread), true);

  IF public.get_overdue_followup_enforcement_enabled() THEN
    RETURN v_payload;
  END IF;

  v_overdue := COALESCE((v_payload->>'overdue')::integer, 0);
  v_tat_defaults := GREATEST(COALESCE((v_payload->>'tat_defaults')::integer, 0) - v_overdue, 0);

  RETURN jsonb_set(
    jsonb_set(v_payload, '{overdue}', '0'::jsonb, true),
    '{tat_defaults}',
    to_jsonb(v_tat_defaults),
    true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.action_center_payload(
  p_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_today jsonb;
BEGIN
  v_payload := public.action_center_payload_base(p_counsellor_id);

  SELECT COALESCE(jsonb_agg(row_payload.value ORDER BY (row_payload.value->>'scheduled_at')::timestamptz), '[]'::jsonb)
  INTO v_today
  FROM jsonb_array_elements(COALESCE(v_payload->'todayFollowups', '[]'::jsonb)) AS row_payload(value)
  WHERE (row_payload.value->>'scheduled_at')::timestamptz <= now();

  v_payload := jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{todayFollowups}', v_today, true);

  IF public.get_overdue_followup_enforcement_enabled() THEN
    RETURN v_payload;
  END IF;

  RETURN jsonb_set(v_payload, '{overdueFollowups}', '[]'::jsonb, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_center_payload(uuid) TO authenticated;

DROP VIEW IF EXISTS public.whatsapp_conversations;
DROP FUNCTION IF EXISTS public.get_whatsapp_conversations();

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversations()
RETURNS TABLE (
  phone text,
  lead_id uuid,
  lead_name text,
  lead_stage text,
  lead_person_role text,
  counsellor_id uuid,
  counsellor_name text,
  course_name text,
  last_message text,
  last_direction text,
  last_message_at timestamptz,
  assigned_to uuid,
  provider text,
  business_phone_number_id text,
  business_phone_number text,
  conversation_mode text,
  conversation_state text,
  owner_user_id uuid,
  escalation_role text,
  handoff_reason text,
  priority text,
  sla_due_at timestamptz,
  last_intent text,
  last_confidence numeric,
  last_bot_action text,
  unread_count integer,
  has_inbound boolean,
  lead_counsellor_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (
    latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  )
    latest.phone,
    latest.lead_id,
    l.name AS lead_name,
    l.stage::text AS lead_stage,
    l.person_role AS lead_person_role,
    l.counsellor_id,
    p.display_name AS counsellor_name,
    c.name AS course_name,
    latest.content AS last_message,
    latest.direction AS last_direction,
    latest.created_at AS last_message_at,
    latest.assigned_to,
    latest.provider,
    latest.business_phone_number_id,
    latest.business_phone_number,
    COALESCE(wcs.mode, 'ai') AS conversation_mode,
    COALESCE(
      wcs.state,
      CASE
        WHEN l.stage = 'dnc' THEN 'dnc'
        WHEN l.stage = 'not_interested' THEN 'not_interested'
        ELSE 'new_unqualified'
      END
    ) AS conversation_state,
    COALESCE(wcs.owner_user_id, l.counsellor_id) AS owner_user_id,
    wcs.escalation_role,
    wcs.handoff_reason,
    COALESCE(wcs.priority, 'normal') AS priority,
    wcs.sla_due_at,
    wcs.last_intent,
    wcs.last_confidence,
    wcs.last_bot_action,
    COALESCE(unread.cnt, 0)::integer AS unread_count,
    COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound,
    COALESCE(cc.ids, ARRAY[]::uuid[]) AS lead_counsellor_ids
  FROM public.whatsapp_messages latest
  LEFT JOIN public.leads l ON l.id = latest.lead_id
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.whatsapp_conversation_state wcs
    ON wcs.phone = latest.phone
   AND wcs.business_number = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm2
    WHERE wm2.phone = latest.phone
      AND wm2.direction = 'inbound'
      AND wm2.is_read = false
      AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_messages replied
        WHERE replied.phone = wm2.phone
          AND replied.direction = 'outbound'
          AND replied.created_at > wm2.created_at
          AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
            = public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
      )
  ) unread ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm3
    WHERE wm3.phone = latest.phone
      AND wm3.direction = 'inbound'
      AND public.whatsapp_conversation_key(wm3.provider, wm3.business_phone_number_id, wm3.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  ) inbound ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT l2.counsellor_id) AS ids
    FROM public.whatsapp_messages wm4
    JOIN public.leads l2 ON l2.id = wm4.lead_id
    WHERE wm4.phone = latest.phone
      AND public.whatsapp_conversation_key(wm4.provider, wm4.business_phone_number_id, wm4.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND l2.counsellor_id IS NOT NULL
  ) cc ON true
  ORDER BY latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number),
    latest.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO service_role;

CREATE VIEW public.whatsapp_conversations
WITH (security_invoker = true) AS
  SELECT * FROM public.get_whatsapp_conversations();

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT SELECT ON public.whatsapp_conversations TO service_role;

CREATE OR REPLACE FUNCTION public.pending_followups_payload(
  p_tab text,
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_scope_unassigned boolean DEFAULT false,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  auth_scope AS (
    SELECT
      public.get_user_role(auth.uid())::text AS role_name,
      (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1) AS own_profile_id
  ),
  scope AS (
    SELECT
      CASE WHEN role_name = 'counsellor' THEN own_profile_id ELSE p_scope_counsellor_id END AS counsellor_id,
      CASE WHEN role_name = 'counsellor' THEN false ELSE COALESCE(p_scope_unassigned, false) END AS unassigned_only,
      GREATEST(COALESCE(p_page, 0), 0) AS page_no,
      LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100) AS page_size
    FROM auth_scope
  ),
  bounds AS (
    SELECT
      date_trunc('day', now()) AS today_start,
      date_trunc('day', now()) + interval '1 day' AS tomorrow_start,
      date_trunc('day', now()) + interval '7 days' AS week_end,
      now() AS current_time
  ),
  scoped_leads AS (
    SELECT l.*
    FROM public.leads l
    CROSS JOIN scope s
    WHERE l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      AND (s.unassigned_only = false OR l.counsellor_id IS NULL)
  ),
  pending_followups AS (
    SELECT lf.*
    FROM public.lead_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
  ),
  followup_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE lf.scheduled_at < b.today_start)::integer AS overdue,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= b.today_start AND lf.scheduled_at <= b.current_time)::integer AS today,
      COUNT(*) FILTER (WHERE lf.scheduled_at > b.current_time AND lf.scheduled_at <= b.week_end)::integer AS upcoming
    FROM pending_followups lf
    CROSS JOIN bounds b
  ),
  visit_confirm_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
  ),
  unclosed_visit_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7
  ),
  post_visit_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.call_logs cl
        WHERE cl.lead_id = cv.lead_id
          AND cl.called_at > cv.visit_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_followups lf
        WHERE lf.lead_id = cv.lead_id
          AND lf.status = 'completed'
          AND lf.completed_at > cv.visit_date
      )
  ),
  counts AS (
    SELECT jsonb_build_object(
      'overdue', CASE WHEN public.get_overdue_followup_enforcement_enabled() THEN COALESCE(fc.overdue, 0) ELSE 0 END,
      'today', COALESCE(fc.today, 0),
      'upcoming', COALESCE(fc.upcoming, 0),
      'visit_confirm', (SELECT COUNT(*)::integer FROM visit_confirm_rows),
      'unclosed_visits', (SELECT COUNT(*)::integer FROM unclosed_visit_rows),
      'post_visit', (SELECT COUNT(*)::integer FROM post_visit_rows)
    ) AS payload
    FROM followup_counts fc
  ),
  followup_items AS (
    SELECT
      lf.scheduled_at AS sort_at,
      jsonb_build_object(
        'id', lf.id,
        'lead_id', lf.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', COALESCE(l.stage::text, ''),
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'counsellor_id', l.counsellor_id,
        'type', COALESCE(lf.type::text, 'call'),
        'scheduled_at', lf.scheduled_at,
        'notes', lf.notes,
        'days_overdue', GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - lf.scheduled_at)) / 86400)::integer),
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM pending_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    CROSS JOIN bounds b
    WHERE (
      (p_tab = 'overdue' AND public.get_overdue_followup_enforcement_enabled() AND lf.scheduled_at < b.today_start)
      OR (p_tab = 'today' AND lf.scheduled_at >= b.today_start AND lf.scheduled_at <= b.current_time)
      OR (p_tab = 'upcoming' AND lf.scheduled_at > b.current_time AND lf.scheduled_at <= b.week_end)
    )
  ),
  visit_confirm_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', '',
        'counsellor_name', '',
        'counsellor_id', l.counsellor_id,
        'type', 'visit_confirmation',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'urgency', CASE
          WHEN cv.visit_date::date = CURRENT_DATE THEN 'same_day'
          WHEN cv.visit_date::date = CURRENT_DATE + 1 THEN 'day_before'
          ELSE 'future'
        END,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    WHERE p_tab = 'visit_confirm'
      AND cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
  ),
  unclosed_visit_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', '',
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'counsellor_id', l.counsellor_id,
        'type', 'unclosed_visit',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'days_overdue', floor(EXTRACT(EPOCH FROM (now() - cv.visit_date)) / 86400)::integer,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE p_tab = 'unclosed_visits'
      AND cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7
  ),
  post_visit_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', COALESCE(l.stage::text, ''),
        'counsellor_name', '',
        'counsellor_id', l.counsellor_id,
        'type', 'post_visit',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'days_since_visit', EXTRACT(DAY FROM now() - cv.visit_date)::integer,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    WHERE p_tab = 'post_visit'
      AND cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.call_logs cl
        WHERE cl.lead_id = cv.lead_id
          AND cl.called_at > cv.visit_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_followups lf
        WHERE lf.lead_id = cv.lead_id
          AND lf.status = 'completed'
          AND lf.completed_at > cv.visit_date
      )
  ),
  all_items AS (
    SELECT * FROM followup_items
    UNION ALL SELECT * FROM visit_confirm_items
    UNION ALL SELECT * FROM unclosed_visit_items
    UNION ALL SELECT * FROM post_visit_items
  ),
  paged_items AS (
    SELECT payload, sort_at
    FROM all_items, scope s
    ORDER BY
      CASE WHEN p_tab = 'upcoming' THEN sort_at END ASC NULLS LAST,
      sort_at ASC
    LIMIT (SELECT page_size FROM scope)
    OFFSET (SELECT page_no * page_size FROM scope)
  )
SELECT jsonb_build_object(
  'counts', (SELECT payload FROM counts),
  'items', COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at ASC) FROM paged_items), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.pending_followups_payload(text, uuid, boolean, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
