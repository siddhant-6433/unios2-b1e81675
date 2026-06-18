-- Align remaining follow-up count surfaces with Pending Follow-ups.
--
-- Surfaces covered here:
-- - direct overdue_followups view consumers
-- - Counsellor Performance summary and overdue tab
-- - TAT Defaults cards/tables
-- - Admissions overview visit action cards
-- - Action Center overdue/today buckets

CREATE OR REPLACE VIEW public.overdue_followups AS
SELECT
  lf.id,
  lf.lead_id,
  lf.user_id AS counsellor_user_id,
  lf.scheduled_at,
  lf.type,
  lf.notes,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.stage AS lead_stage,
  l.counsellor_id,
  EXTRACT(DAY FROM now() - lf.scheduled_at)::integer AS days_overdue
FROM public.lead_followups lf
JOIN public.leads l ON l.id = lf.lead_id
WHERE public.get_overdue_followup_enforcement_enabled()
  AND lf.status = 'pending'
  AND lf.scheduled_at < date_trunc('day', now())
  AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
ORDER BY lf.scheduled_at ASC;

ALTER VIEW public.overdue_followups SET (security_invoker = true);
GRANT SELECT ON public.overdue_followups TO authenticated;

CREATE OR REPLACE VIEW public.counsellor_tat_defaults AS
WITH counsellors AS (
  SELECT p.id AS profile_id, p.user_id, p.display_name, p.phone
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'counsellor'
),
sla_breaches AS (
  SELECT l.counsellor_id AS profile_id, COUNT(*) AS cnt
  FROM public.leads l
  JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
  WHERE l.first_contact_at IS NULL
    AND l.assigned_at IS NOT NULL
    AND l.counsellor_id IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 > sc.first_contact_hours
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  GROUP BY l.counsellor_id
),
overdue_fups AS (
  SELECT l.counsellor_id AS profile_id, COUNT(*) AS cnt
  FROM public.lead_followups lf
  JOIN public.leads l ON l.id = lf.lead_id
  WHERE public.get_overdue_followup_enforcement_enabled()
    AND lf.status = 'pending'
    AND lf.scheduled_at < date_trunc('day', now())
    AND l.counsellor_id IS NOT NULL
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible', 'cold')
  GROUP BY l.counsellor_id
),
app_checkins AS (
  SELECT l.counsellor_id AS profile_id, COUNT(*) AS cnt
  FROM public.leads l
  JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
  WHERE l.counsellor_id IS NOT NULL
    AND sc.checkin_interval_hours IS NOT NULL
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
    AND NOT EXISTS (
      SELECT 1
      FROM public.lead_activities la
      WHERE la.lead_id = l.id
        AND la.created_at > now() - make_interval(hours => sc.checkin_interval_hours)
    )
  GROUP BY l.counsellor_id
)
SELECT
  c.profile_id,
  c.user_id,
  c.display_name AS counsellor_name,
  c.phone AS counsellor_phone,
  COALESCE(sb.cnt, 0)::int AS new_leads_overdue,
  COALESCE(ofu.cnt, 0)::int AS overdue_followups,
  COALESCE(ac.cnt, 0)::int AS app_checkins_overdue,
  (COALESCE(sb.cnt, 0) + COALESCE(ofu.cnt, 0) + COALESCE(ac.cnt, 0))::int AS total_defaults
FROM counsellors c
LEFT JOIN sla_breaches sb ON sb.profile_id = c.profile_id
LEFT JOIN overdue_fups ofu ON ofu.profile_id = c.profile_id
LEFT JOIN app_checkins ac ON ac.profile_id = c.profile_id;

ALTER VIEW public.counsellor_tat_defaults SET (security_invoker = true);
GRANT SELECT ON public.counsellor_tat_defaults TO authenticated;

CREATE OR REPLACE FUNCTION public.my_tat_defaults(
  p_scope_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role_name text;
  v_own_profile_id uuid;
  v_scope_counsellor_id uuid;
  v_user_id uuid;
  v_name text;
  v_new_leads_overdue integer := 0;
  v_overdue_followups integer := 0;
  v_app_checkins_overdue integer := 0;
BEGIN
  v_role_name := public.get_user_role(auth.uid())::text;

  SELECT p.id, p.user_id, p.display_name
  INTO v_own_profile_id, v_user_id, v_name
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_role_name = 'counsellor' THEN
    v_scope_counsellor_id := v_own_profile_id;
  ELSE
    v_scope_counsellor_id := p_scope_counsellor_id;
  END IF;

  IF v_scope_counsellor_id IS NULL THEN
    RETURN jsonb_build_object(
      'profile_id', null,
      'user_id', null,
      'counsellor_name', '',
      'new_leads_overdue', 0,
      'overdue_followups', 0,
      'app_checkins_overdue', 0,
      'total_defaults', 0
    );
  END IF;

  IF v_role_name <> 'counsellor' THEN
    SELECT p.user_id, p.display_name
    INTO v_user_id, v_name
    FROM public.profiles p
    WHERE p.id = v_scope_counsellor_id
    LIMIT 1;
  END IF;

  SELECT COUNT(*)::integer INTO v_new_leads_overdue
  FROM public.leads l
  JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
  WHERE l.counsellor_id = v_scope_counsellor_id
    AND l.first_contact_at IS NULL
    AND l.assigned_at IS NOT NULL
    AND l.counsellor_id IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 > sc.first_contact_hours
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested');

  SELECT COUNT(*)::integer INTO v_overdue_followups
  FROM public.lead_followups lf
  JOIN public.leads l ON l.id = lf.lead_id
  WHERE public.get_overdue_followup_enforcement_enabled()
    AND lf.status = 'pending'
    AND lf.scheduled_at < date_trunc('day', now())
    AND l.counsellor_id = v_scope_counsellor_id
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible', 'cold');

  SELECT COUNT(*)::integer INTO v_app_checkins_overdue
  FROM public.leads l
  JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
  WHERE l.counsellor_id = v_scope_counsellor_id
    AND sc.checkin_interval_hours IS NOT NULL
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
    AND NOT EXISTS (
      SELECT 1
      FROM public.lead_activities la
      WHERE la.lead_id = l.id
        AND la.created_at > now() - make_interval(hours => sc.checkin_interval_hours)
    );

  RETURN jsonb_build_object(
    'profile_id', v_scope_counsellor_id,
    'user_id', v_user_id,
    'counsellor_name', COALESCE(v_name, 'Unknown'),
    'new_leads_overdue', v_new_leads_overdue,
    'overdue_followups', v_overdue_followups,
    'app_checkins_overdue', v_app_checkins_overdue,
    'total_defaults', v_new_leads_overdue + v_overdue_followups + v_app_checkins_overdue
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_tat_defaults(uuid) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.admissions_overview_base(uuid, uuid)') IS NULL
     AND to_regprocedure('public.admissions_overview(uuid, uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.admissions_overview(uuid, uuid)
    RENAME TO admissions_overview_base;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admissions_overview(
  p_counsellor_id uuid DEFAULT NULL,
  p_campus_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_overdue_followups integer := 0;
  v_ai_needs_followup integer := 0;
BEGIN
  v_payload := public.admissions_overview_base(p_counsellor_id, p_campus_id);

  WITH scoped_leads AS (
    SELECT l.id, l.stage
    FROM public.leads l
    WHERE l.is_mirror = false
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
      AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id)
  )
  SELECT COUNT(*)::integer
  INTO v_overdue_followups
  FROM public.lead_followups lf
  JOIN scoped_leads l ON l.id = lf.lead_id
  WHERE public.get_overdue_followup_enforcement_enabled()
    AND lf.status = 'pending'
    AND lf.scheduled_at < date_trunc('day', now())
    AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');

  WITH scoped_leads AS (
    SELECT l.id
    FROM public.leads l
    WHERE l.is_mirror = false
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
      AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id)
  )
  SELECT COUNT(*)::integer
  INTO v_ai_needs_followup
  FROM public.ai_call_records acr
  JOIN scoped_leads l ON l.id = acr.lead_id
  WHERE acr.needs_followup = true
    AND acr.followup_done_at IS NULL;

  RETURN jsonb_set(
    COALESCE(v_payload, '{}'::jsonb),
    '{visit_action_counts,overdueFollowups}',
    to_jsonb(v_overdue_followups + v_ai_needs_followup),
    true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admissions_overview(uuid, uuid) TO authenticated;

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
  v_overdue jsonb;
  v_today jsonb;
BEGIN
  v_payload := public.action_center_payload_base(p_counsellor_id);

  WITH all_followups AS (
    SELECT row_payload.value AS payload
    FROM jsonb_array_elements(COALESCE(v_payload->'overdueFollowups', '[]'::jsonb)) AS row_payload(value)
    UNION ALL
    SELECT row_payload.value AS payload
    FROM jsonb_array_elements(COALESCE(v_payload->'todayFollowups', '[]'::jsonb)) AS row_payload(value)
  )
  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'scheduled_at')::timestamptz), '[]'::jsonb)
  INTO v_overdue
  FROM all_followups
  WHERE public.get_overdue_followup_enforcement_enabled()
    AND (payload->>'scheduled_at')::timestamptz < date_trunc('day', now());

  WITH all_followups AS (
    SELECT row_payload.value AS payload
    FROM jsonb_array_elements(COALESCE(v_payload->'overdueFollowups', '[]'::jsonb)) AS row_payload(value)
    UNION ALL
    SELECT row_payload.value AS payload
    FROM jsonb_array_elements(COALESCE(v_payload->'todayFollowups', '[]'::jsonb)) AS row_payload(value)
  )
  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'scheduled_at')::timestamptz), '[]'::jsonb)
  INTO v_today
  FROM all_followups
  WHERE (payload->>'scheduled_at')::timestamptz >= date_trunc('day', now())
    AND (payload->>'scheduled_at')::timestamptz <= now();

  v_payload := jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{overdueFollowups}', v_overdue, true);
  v_payload := jsonb_set(v_payload, '{todayFollowups}', v_today, true);

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_center_payload(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.counsellor_calling_summary(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := public.counsellor_calling_summary_base(p_from_date, p_to_date);

  WITH row_payloads AS (
    SELECT row_payload.value AS payload
    FROM jsonb_array_elements(COALESCE(v_payload, '[]'::jsonb)) AS row_payload(value)
  ),
  overdue_counts AS (
    SELECT l.counsellor_id AS profile_id, COUNT(lf.id)::integer AS overdue_followups
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE public.get_overdue_followup_enforcement_enabled()
      AND lf.status = 'pending'
      AND lf.scheduled_at < date_trunc('day', now())
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible', 'cold')
    GROUP BY l.counsellor_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_set(
        rp.payload,
        '{overdueFollowups}',
        to_jsonb(COALESCE(oc.overdue_followups, 0)),
        true
      )
      ORDER BY COALESCE((rp.payload->>'notCalled')::integer, 0) DESC
    ),
    '[]'::jsonb
  )
  INTO v_payload
  FROM row_payloads rp
  LEFT JOIN overdue_counts oc ON oc.profile_id::text = rp.payload->>'profileId';

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.counsellor_calling_summary(date, date) TO authenticated;

DROP FUNCTION IF EXISTS public.get_counsellor_performance_stats();
CREATE OR REPLACE FUNCTION public.get_counsellor_performance_stats()
RETURNS TABLE (
  counsellor_id uuid,
  counsellor_name text,
  user_id uuid,
  total_calls bigint,
  total_whatsapps bigint,
  followups_completed bigint,
  followups_overdue bigint,
  visits_scheduled bigint,
  leads_assigned bigint,
  conversions bigint,
  applications bigint,
  applications_paid bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS counsellor_id,
    p.display_name AS counsellor_name,
    p.user_id,
    (SELECT COUNT(*) FROM public.call_logs cl WHERE cl.user_id = p.user_id)::bigint AS total_calls,
    (SELECT COUNT(*) FROM public.lead_activities la WHERE la.user_id = p.user_id AND la.type = 'whatsapp')::bigint AS total_whatsapps,
    (SELECT COUNT(*) FROM public.lead_followups lf WHERE lf.user_id = p.user_id AND lf.status = 'completed')::bigint AS followups_completed,
    (
      SELECT COUNT(*)
      FROM public.lead_followups lf
      JOIN public.leads l ON l.id = lf.lead_id
      WHERE public.get_overdue_followup_enforcement_enabled()
        AND lf.user_id = p.user_id
        AND lf.status = 'pending'
        AND lf.scheduled_at < date_trunc('day', now())
        AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
    )::bigint AS followups_overdue,
    (SELECT COUNT(*) FROM public.campus_visits cv WHERE cv.scheduled_by = p.id)::bigint AS visits_scheduled,
    (SELECT COUNT(*) FROM public.leads l WHERE l.counsellor_id = p.id)::bigint AS leads_assigned,
    (SELECT COUNT(*) FROM public.leads l WHERE l.counsellor_id = p.id AND l.stage = 'admitted')::bigint AS conversions,
    (SELECT COUNT(*) FROM public.applications a INNER JOIN public.leads l ON l.id = a.lead_id WHERE l.counsellor_id = p.id)::bigint AS applications,
    (SELECT COUNT(*) FROM public.applications a INNER JOIN public.leads l ON l.id = a.lead_id WHERE l.counsellor_id = p.id AND a.payment_status = 'paid')::bigint AS applications_paid
  FROM public.profiles p
  INNER JOIN public.user_roles ur ON ur.user_id = p.user_id
    AND ur.role IN ('counsellor', 'admission_head')
  ORDER BY p.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_counsellor_performance_stats() TO authenticated;
NOTIFY pgrst, 'reload schema';
