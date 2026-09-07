-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905070202 name=cold_call_contact_aware_list_surfaces applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.preview_call_list_assignment(
  _list_id uuid,
  _include_terminal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total',    count(*)::int,
    'no_phone', count(*) FILTER (WHERE COALESCE(l.phone, c.phone) IS NULL)::int,
    'terminal', count(*) FILTER (
                  WHERE m.lead_id IS NOT NULL
                    AND l.phone IS NOT NULL
                    AND l.stage IN ('not_interested','dnc','rejected','ineligible','admitted'))::int,
    'dialable', count(*) FILTER (
                  WHERE CASE
                    WHEN m.contact_id IS NOT NULL
                      THEN c.phone IS NOT NULL AND NOT c.opted_out AND c.promoted_lead_id IS NULL
                    ELSE l.phone IS NOT NULL
                         AND (_include_terminal
                              OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible','admitted'))
                  END)::int
  )
  FROM public.lead_list_members m
  LEFT JOIN public.leads l              ON l.id = m.lead_id
  LEFT JOIN public.marketing_contacts c ON c.id = m.contact_id
  WHERE m.list_id = _list_id;
$function$;

REVOKE ALL ON FUNCTION public.preview_call_list_assignment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_call_list_assignment(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cloud_dialer_campaign_queue(
  p_list_id       uuid,
  p_counsellor_id uuid    DEFAULT NULL,
  p_limit         integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_is_admin   boolean;
  v_result     jsonb;
BEGIN
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1;

  v_is_admin := public.has_role(auth.uid(), 'super_admin'::public.app_role)
             OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
             OR public.has_role(auth.uid(), 'principal'::public.app_role)
             OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
             OR EXISTS (SELECT 1 FROM public.teams t WHERE t.leader_id = v_profile_id);

  WITH cfg AS (
    SELECT COALESCE(include_terminal, false) AS include_terminal
    FROM public.lead_lists WHERE id = p_list_id
  ),
  members AS (
    SELECT m.id AS member_id, m.lead_id, m.contact_id, m.sort_order, m.added_at,
           m.attempt_count, m.next_attempt_at
    FROM public.lead_list_members m
    LEFT JOIN public.leads l              ON l.id = m.lead_id
    LEFT JOIN public.marketing_contacts c ON c.id = m.contact_id
    CROSS JOIN cfg
    WHERE m.list_id = p_list_id
      AND m.work_status = 'pending'
      AND (m.next_attempt_at IS NULL OR m.next_attempt_at <= now())
      AND CASE
            WHEN m.contact_id IS NOT NULL
              THEN c.phone IS NOT NULL AND NOT c.opted_out AND c.promoted_lead_id IS NULL
            ELSE l.phone IS NOT NULL
                 AND (cfg.include_terminal
                      OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible','admitted'))
          END
      AND (
        (v_is_admin AND (p_counsellor_id IS NULL OR m.assigned_to = p_counsellor_id))
        OR (NOT v_is_admin AND m.assigned_to = v_profile_id)
      )
    ORDER BY m.next_attempt_at NULLS FIRST, m.sort_order NULLS LAST, m.added_at
    LIMIT GREATEST(1, LEAST(p_limit, 1000))
  ),
  enriched AS (
    SELECT
      COALESCE(m.lead_id, m.contact_id) AS id,
      m.member_id,
      CASE WHEN m.contact_id IS NOT NULL THEN 'contact' ELSE 'lead' END AS kind,
      COALESCE(l.name, c.name)          AS name,
      COALESCE(l.phone, c.phone)        AS phone,
      COALESCE(l.stage::text, '')       AS stage,
      COALESCE(l.source::text, 'cold_list') AS source,
      COALESCE(l.city, c.city)          AS city,
      l.course_id,
      COALESCE(co.name, '—')            AS course_name,
      co.fee_per_year                   AS course_fee_per_year,
      COALESCE(cmp.name, '—')           AS campus_name,
      CASE WHEN m.contact_id IS NOT NULL THEN 'Cold List' ELSE 'Call List' END AS bucket,
      0                                 AS bucket_priority,
      COALESCE(m.attempt_count, 0)      AS attempt_count,
      l.assigned_at, l.first_contact_at,
      NULL::uuid AS followup_id,
      NULL::text AS followup_type,
      row_number() OVER (ORDER BY m.next_attempt_at NULLS FIRST,
                                  m.sort_order NULLS LAST, m.added_at) AS list_position
    FROM members m
    LEFT JOIN public.leads l              ON l.id  = m.lead_id
    LEFT JOIN public.marketing_contacts c ON c.id  = m.contact_id
    LEFT JOIN public.courses co           ON co.id = l.course_id
    LEFT JOIN public.campuses cmp         ON cmp.id = l.campus_id
  )
  SELECT jsonb_build_object(
    'queue', COALESCE(
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.list_position) FROM enriched e),
      '[]'::jsonb
    ),
    'buckets', CASE
      WHEN (SELECT count(*) FROM enriched) > 0 THEN jsonb_build_array(jsonb_build_object(
        'bucket_priority', 0, 'label', 'Call List',
        'count', (SELECT count(*)::int FROM enriched)
      ))
      ELSE '[]'::jsonb
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_call_list_undialable(_list_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_leads    integer := 0;
  v_contacts integer := 0;
BEGIN
  PERFORM set_config('statement_timeout', '300s', true);

  WITH marked AS (
    UPDATE public.lead_list_members m
       SET work_status = 'not_dialable'
      FROM public.leads l, public.lead_lists ll
     WHERE m.list_id = _list_id AND ll.id = _list_id AND l.id = m.lead_id
       AND m.work_status = 'pending'
       AND (l.phone IS NULL
            OR (NOT ll.include_terminal
                AND l.stage IN ('not_interested','dnc','rejected','ineligible','admitted')))
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_leads FROM marked;

  WITH marked AS (
    UPDATE public.lead_list_members m
       SET work_status = 'not_dialable'
      FROM public.marketing_contacts c
     WHERE m.list_id = _list_id AND c.id = m.contact_id
       AND m.work_status = 'pending'
       AND (c.phone IS NULL OR c.opted_out OR c.promoted_lead_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_contacts FROM marked;

  RETURN v_leads + v_contacts;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_call_list_undialable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_call_list_undialable(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.call_list_progress(p_list_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH members AS (
    SELECT * FROM public.lead_list_members m WHERE m.list_id = p_list_id
  ),
  latest_call AS (
    SELECT m.id AS member_id, cl.disposition, cl.called_at
    FROM members m
    JOIN public.call_logs cl ON cl.id = m.call_log_id
    WHERE m.work_status = 'worked'
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (m.id) m.id AS member_id, cl.disposition, cl.called_at
      FROM members m
      JOIN public.profiles cp ON cp.id = m.assigned_to
      JOIN public.call_logs cl
        ON cl.lead_id = m.lead_id
       AND cl.user_id = cp.user_id
       AND (m.assigned_at IS NULL OR cl.called_at >= m.assigned_at)
      WHERE m.work_status = 'worked'
        AND m.call_log_id IS NULL
        AND m.lead_id IS NOT NULL
      ORDER BY m.id, cl.called_at DESC
    ) fallback
  )
  SELECT jsonb_build_object(
    'list_id', p_list_id,
    'total',   (SELECT count(*)::int FROM members),
    'dialable', (SELECT count(*) FILTER (WHERE work_status <> 'not_dialable')::int FROM members),
    'pending', (SELECT count(*) FILTER (WHERE work_status = 'pending')::int FROM members),
    'worked',  (SELECT count(*) FILTER (WHERE work_status = 'worked')::int  FROM members),
    'skipped', (SELECT count(*) FILTER (WHERE work_status = 'skipped')::int FROM members),
    'not_dialable', (SELECT count(*) FILTER (WHERE work_status = 'not_dialable')::int FROM members),
    'last_call_at', (SELECT max(called_at) FROM latest_call),
    'dispositions', COALESCE((
      SELECT jsonb_object_agg(COALESCE(disposition, 'unrecorded'), n ORDER BY n DESC)
      FROM (SELECT disposition, count(*)::int AS n FROM latest_call GROUP BY disposition) z
    ), '{}'::jsonb),
    'by_counsellor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'counsellor_id', p.id,
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'total',   c.total,
        'worked',  c.worked,
        'pending', c.pending
      ) ORDER BY c.pending DESC)
      FROM (
        SELECT m2.assigned_to,
               count(*) FILTER (WHERE m2.work_status <> 'not_dialable')::int AS total,
               count(*) FILTER (WHERE m2.work_status = 'worked')::int  AS worked,
               count(*) FILTER (WHERE m2.work_status = 'pending')::int AS pending
        FROM members m2
        WHERE m2.assigned_to IS NOT NULL
        GROUP BY m2.assigned_to
      ) c
      JOIN public.profiles p ON p.id = c.assigned_to
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.call_list_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_progress(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.skip_call_list_member(p_member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_n          integer;
BEGIN
  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  UPDATE public.lead_list_members
     SET work_status = 'skipped', worked_at = now()
   WHERE id = p_member_id
     AND work_status = 'pending'
     AND (assigned_to IS NOT DISTINCT FROM v_profile_id OR public.can_manage_lead_lists());

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.skip_call_list_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_call_list_member(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
