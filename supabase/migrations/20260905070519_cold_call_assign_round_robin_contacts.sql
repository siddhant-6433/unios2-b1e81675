-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905070519 name=cold_call_assign_round_robin_contacts applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP FUNCTION IF EXISTS public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean);

CREATE FUNCTION public.assign_lead_list_round_robin(
  _list_id uuid,
  _counsellor_ids uuid[],
  _only_unassigned boolean DEFAULT false,
  _priority_note text DEFAULT NULL::text,
  _due_date date DEFAULT NULL::date,
  _include_terminal boolean DEFAULT false,
  _limit integer DEFAULT 5000
)
RETURNS TABLE(batch_id uuid, counsellor_id uuid, counsellor_name text, assigned_count integer, failed_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_user_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
  v_is_team_leader boolean;
  v_list_name text;
  v_batch_id uuid;
  v_total_leads integer := 0;
  v_assigned_count integer := 0;
  v_valid_counsellor_count integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _list_id IS NULL THEN
    RAISE EXCEPTION 'List is required';
  END IF;

  IF COALESCE(array_length(_counsellor_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one counsellor is required';
  END IF;

  PERFORM set_config('statement_timeout', '300s', true);

  SELECT p.id INTO v_caller_profile_id
  FROM public.profiles p
  WHERE p.user_id = v_caller_user_id
  LIMIT 1;

  v_is_admin := public.has_role(v_caller_user_id, 'super_admin'::public.app_role)
                OR public.has_role(v_caller_user_id, 'admission_head'::public.app_role)
                OR public.has_role(v_caller_user_id, 'principal'::public.app_role);

  v_is_team_leader := EXISTS (
    SELECT 1 FROM public.teams t WHERE t.leader_id = v_caller_profile_id
  );

  IF NOT (v_is_admin OR v_is_team_leader) THEN
    RAISE EXCEPTION 'Insufficient permissions to assign lead lists';
  END IF;

  SELECT l.name INTO v_list_name FROM public.lead_lists l WHERE l.id = _list_id;
  IF v_list_name IS NULL THEN
    RAISE EXCEPTION 'Lead list not found';
  END IF;

  WITH requested AS (
    SELECT DISTINCT x.counsellor_id
    FROM unnest(_counsellor_ids) AS x(counsellor_id)
    WHERE x.counsellor_id IS NOT NULL
  ),
  valid AS (
    SELECT p.id
    FROM requested r
    JOIN public.profiles p ON p.id = r.counsellor_id
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'counsellor'::public.app_role
      AND COALESCE(p.login_disabled, false) = false
      AND (
        v_is_admin
        OR p.id = v_caller_profile_id
        OR EXISTS (
          SELECT 1
          FROM public.teams t
          JOIN public.team_members tm ON tm.team_id = t.id
          JOIN public.profiles member ON member.user_id = tm.user_id
          WHERE t.leader_id = v_caller_profile_id
            AND member.id = p.id
        )
      )
  )
  SELECT count(*) INTO v_valid_counsellor_count FROM valid;

  IF v_valid_counsellor_count <> (
    SELECT count(DISTINCT id) FROM unnest(_counsellor_ids) AS ids(id) WHERE id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'One or more selected counsellors are outside your assignment scope';
  END IF;

  UPDATE public.lead_lists
     SET purpose = 'calling',
         is_active = true,
         include_terminal = _include_terminal,
         priority_note = COALESCE(_priority_note, priority_note),
         due_date = COALESCE(_due_date, due_date),
         updated_at = v_now
   WHERE id = _list_id;

  DROP TABLE IF EXISTS _eligible_members;
  DROP TABLE IF EXISTS _assignments;

  CREATE TEMP TABLE _eligible_members ON COMMIT DROP AS
  SELECT llm.id AS member_id,
         llm.lead_id,
         llm.contact_id,
         row_number() OVER (ORDER BY (llm.assigned_to IS NOT NULL), llm.added_at, llm.id) AS lead_index
  FROM public.lead_list_members llm
  LEFT JOIN public.leads l              ON l.id = llm.lead_id
  LEFT JOIN public.marketing_contacts c ON c.id = llm.contact_id
  WHERE llm.list_id = _list_id
    AND (NOT _only_unassigned OR llm.contact_id IS NOT NULL OR l.counsellor_id IS NULL)
    AND (llm.contact_id IS NULL
         OR (c.phone IS NOT NULL AND NOT c.opted_out AND c.promoted_lead_id IS NULL))
  ORDER BY (llm.assigned_to IS NOT NULL), llm.added_at, llm.id
  LIMIT GREATEST(1, _limit);

  SELECT count(*) INTO v_total_leads FROM _eligible_members;

  INSERT INTO public.lead_list_assignment_batches (
    list_id, assigned_by_profile_id, assigned_by_user_id, counsellor_ids, total_leads
  )
  VALUES (
    _list_id,
    v_caller_profile_id,
    v_caller_user_id,
    (SELECT array_agg(id ORDER BY ord)
     FROM (
       SELECT DISTINCT ON (p.id) p.id, requested.ord
       FROM unnest(_counsellor_ids) WITH ORDINALITY AS requested(id, ord)
       JOIN public.profiles p ON p.id = requested.id
       WHERE requested.id IS NOT NULL
       ORDER BY p.id, requested.ord
     ) ordered),
    v_total_leads
  )
  RETURNING id INTO v_batch_id;

  PERFORM set_config('app.bulk_assign', 'on', true);

  CREATE TEMP TABLE _assignments ON COMMIT DROP AS
  WITH selected_counsellors AS (
    SELECT p.id AS counsellor_id,
           row_number() OVER (ORDER BY requested.ord) AS counsellor_index
    FROM (
      SELECT DISTINCT ON (id) id, ord
      FROM unnest(_counsellor_ids) WITH ORDINALITY AS u(id, ord)
      WHERE id IS NOT NULL
      ORDER BY id, ord
    ) requested
    JOIN public.profiles p ON p.id = requested.id
  ),
  counsellor_count AS (
    SELECT count(*)::integer AS n FROM selected_counsellors
  )
  SELECT om.member_id, om.lead_id, om.contact_id, om.lead_index, sc.counsellor_id
  FROM _eligible_members om
  CROSS JOIN counsellor_count cc
  JOIN selected_counsellors sc
    ON sc.counsellor_index = ((om.lead_index - 1) % cc.n) + 1;

  WITH current_rows AS (
    SELECT l.id AS lead_id,
           l.counsellor_id AS previous_counsellor_id,
           l.stage AS lead_stage_at_assignment,
           a.counsellor_id
    FROM _assignments a
    JOIN public.leads l ON l.id = a.lead_id
    WHERE a.lead_id IS NOT NULL
  ),
  updated AS (
    UPDATE public.leads l
       SET counsellor_id = cr.counsellor_id,
           assigned_at = v_now
      FROM current_rows cr
     WHERE l.id = cr.lead_id
     RETURNING l.id
  ),
  history_insert AS (
    INSERT INTO public.lead_assignment_history (
      lead_id, assigned_to, previous_counsellor_id, assigned_by_profile_id,
      assigned_by_user_id, assignment_source, bucket_name,
      lead_stage_at_assignment, list_id, list_assignment_batch_id
    )
    SELECT cr.lead_id, cr.counsellor_id, cr.previous_counsellor_id, v_caller_profile_id,
           v_caller_user_id, 'list_round_robin', 'Lead List',
           cr.lead_stage_at_assignment, _list_id, v_batch_id
    FROM current_rows cr
    JOIN updated u ON u.id = cr.lead_id
    RETURNING assigned_to
  )
  SELECT count(*)::integer INTO v_assigned_count FROM history_insert;

  v_assigned_count := v_assigned_count
    + (SELECT count(*)::integer FROM _assignments WHERE contact_id IS NOT NULL);

  UPDATE public.lead_list_members m
     SET assigned_to = a.counsellor_id,
         work_status = 'pending',
         worked_at = NULL,
         call_log_id = NULL,
         next_attempt_at = NULL,
         attempt_count = 0,
         assigned_at = v_now,
         sort_order = a.lead_index::integer
    FROM _assignments a
   WHERE m.id = a.member_id;

  PERFORM public.mark_call_list_undialable(_list_id);

  UPDATE public.lead_list_assignment_batches
     SET assigned_count = v_assigned_count,
         failed_count = GREATEST(v_total_leads - v_assigned_count, 0)
   WHERE id = v_batch_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT p.user_id,
         'lead_assigned',
         'Priority call list: ' || v_list_name,
         cnt.n || ' lead' || CASE WHEN cnt.n = 1 THEN '' ELSE 's' END || ' to call'
           || CASE WHEN _due_date IS NOT NULL THEN ' by ' || to_char(_due_date, 'DD Mon') ELSE '' END
           || COALESCE('. ' || _priority_note, '')
           || '. Open Cloud Dialer to start.',
         '/cloud-dialer?list=' || _list_id
  FROM (
    SELECT a.counsellor_id, count(*)::integer AS n
    FROM _assignments a
    LEFT JOIN public.leads l ON l.id = a.lead_id
    WHERE a.contact_id IS NOT NULL
       OR (l.phone IS NOT NULL
           AND (_include_terminal
                OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible','admitted')))
    GROUP BY a.counsellor_id
  ) cnt
  JOIN public.profiles p ON p.id = cnt.counsellor_id
  WHERE p.user_id IS NOT NULL;

  RETURN QUERY
  WITH selected_counsellors AS (
    SELECT p.id AS counsellor_id,
           COALESCE(p.display_name, 'Unknown')::text AS counsellor_name,
           row_number() OVER (ORDER BY requested.ord) AS counsellor_index
    FROM (
      SELECT DISTINCT ON (id) id, ord
      FROM unnest(_counsellor_ids) WITH ORDINALITY AS u(id, ord)
      WHERE id IS NOT NULL
      ORDER BY id, ord
    ) requested
    JOIN public.profiles p ON p.id = requested.id
  ),
  expected AS (
    SELECT a.counsellor_id, count(*)::integer AS n FROM _assignments a GROUP BY a.counsellor_id
  ),
  counts AS (
    SELECT h.assigned_to, count(*)::integer AS assigned_count
    FROM public.lead_assignment_history h
    WHERE h.list_assignment_batch_id = v_batch_id
    GROUP BY h.assigned_to
    UNION ALL
    SELECT a.counsellor_id, count(*)::integer
    FROM _assignments a WHERE a.contact_id IS NOT NULL
    GROUP BY a.counsellor_id
  ),
  counts_rolled AS (
    SELECT assigned_to, sum(assigned_count)::integer AS assigned_count
    FROM counts GROUP BY assigned_to
  )
  SELECT
    v_batch_id,
    sc.counsellor_id,
    sc.counsellor_name,
    COALESCE(c.assigned_count, 0)::integer,
    GREATEST(COALESCE(e.n, 0) - COALESCE(c.assigned_count, 0), 0)::integer
  FROM selected_counsellors sc
  LEFT JOIN counts_rolled c ON c.assigned_to = sc.counsellor_id
  LEFT JOIN expected e ON e.counsellor_id = sc.counsellor_id
  ORDER BY sc.counsellor_index;
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
