-- Calling Report / dashboard counsellor chips grouped only by
-- lead_list_members.assigned_to. The per-lead Calling Report reads
-- lead_assignment_history, so a list round-robin'd to three counsellors
-- (or later reassigned) showed one name in the header while the table
-- listed the people who actually received the leads.
--
-- Attribute by_counsellor from the latest list-assignment history row per
-- lead, falling back to the member assignee when history is missing.

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
  latest_list_assignee AS (
    SELECT DISTINCT ON (h.lead_id)
      h.lead_id,
      h.assigned_to
    FROM public.lead_assignment_history h
    WHERE h.list_id = p_list_id
      AND h.lead_id IS NOT NULL
      AND h.assigned_to IS NOT NULL
    ORDER BY h.lead_id, h.created_at DESC
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
    'unassigned_pending', (SELECT count(*) FILTER (WHERE work_status = 'pending' AND assigned_to IS NULL)::int FROM members),
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
        SELECT COALESCE(la.assigned_to, m2.assigned_to) AS assigned_to,
               count(*) FILTER (WHERE m2.work_status <> 'not_dialable')::int AS total,
               count(*) FILTER (WHERE m2.work_status = 'worked')::int  AS worked,
               count(*) FILTER (WHERE m2.work_status = 'pending')::int AS pending
        FROM members m2
        LEFT JOIN latest_list_assignee la ON la.lead_id = m2.lead_id
        WHERE COALESCE(la.assigned_to, m2.assigned_to) IS NOT NULL
        GROUP BY COALESCE(la.assigned_to, m2.assigned_to)
      ) c
      JOIN public.profiles p ON p.id = c.assigned_to
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.call_list_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_progress(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.call_list_overview(p_include_done boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_is_admin boolean;
  v_is_team_leader boolean;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1;

  v_is_admin := public.has_role(auth.uid(), 'super_admin'::public.app_role)
             OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
             OR public.has_role(auth.uid(), 'principal'::public.app_role)
             OR public.has_role(auth.uid(), 'campus_admin'::public.app_role);

  v_is_team_leader := EXISTS (SELECT 1 FROM public.teams t WHERE t.leader_id = v_profile_id);

  IF NOT (v_is_admin OR v_is_team_leader) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH visible_members AS (
    SELECT m.list_id, m.lead_id, m.assigned_to, m.work_status, m.worked_at, m.assigned_at
    FROM public.lead_list_members m
    JOIN public.lead_lists ll ON ll.id = m.list_id
    WHERE ll.purpose = 'calling'
      AND ll.is_active
      AND (
        v_is_admin
        OR m.assigned_to IN (
          SELECT member.id
          FROM public.teams t
          JOIN public.team_members tm ON tm.team_id = t.id
          JOIN public.profiles member ON member.user_id = tm.user_id
          WHERE t.leader_id = v_profile_id
        )
      )
  ),
  latest_list_assignee AS (
    SELECT DISTINCT ON (h.list_id, h.lead_id)
      h.list_id,
      h.lead_id,
      h.assigned_to
    FROM public.lead_assignment_history h
    WHERE h.list_id IN (SELECT list_id FROM visible_members)
      AND h.lead_id IS NOT NULL
      AND h.assigned_to IS NOT NULL
    ORDER BY h.list_id, h.lead_id, h.created_at DESC
  ),
  latest_call AS (
    SELECT DISTINCT ON (vm.list_id, vm.lead_id)
      vm.list_id,
      vm.lead_id,
      cl.disposition,
      cl.called_at
    FROM visible_members vm
    JOIN public.profiles cp ON cp.id = vm.assigned_to
    JOIN public.call_logs cl
      ON cl.lead_id = vm.lead_id
     AND cl.user_id = cp.user_id
     AND (vm.assigned_at IS NULL OR cl.called_at >= vm.assigned_at)
    WHERE vm.work_status = 'worked'
    ORDER BY vm.list_id, vm.lead_id, cl.called_at DESC
  ),
  dispositions AS (
    SELECT list_id,
           jsonb_object_agg(COALESCE(disposition, 'unrecorded'), n ORDER BY n DESC) AS breakdown,
           max(last_at) AS last_call_at
    FROM (
      SELECT list_id,
             disposition,
             count(*)::int AS n,
             max(called_at) AS last_at
      FROM latest_call
      GROUP BY list_id, disposition
    ) d
    GROUP BY list_id
  ),
  per_counsellor AS (
    SELECT c.list_id,
           jsonb_agg(jsonb_build_object(
             'counsellor_id', p.id,
             'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
             'total', c.total,
             'worked', c.worked,
             'pending', c.pending
           ) ORDER BY c.pending DESC) AS rows
    FROM (
      SELECT vm.list_id,
             COALESCE(la.assigned_to, vm.assigned_to) AS assigned_to,
             count(*) FILTER (WHERE vm.work_status <> 'not_dialable')::int AS total,
             count(*) FILTER (WHERE vm.work_status = 'worked')::int AS worked,
             count(*) FILTER (WHERE vm.work_status = 'pending')::int AS pending
      FROM visible_members vm
      LEFT JOIN latest_list_assignee la
        ON la.list_id = vm.list_id AND la.lead_id = vm.lead_id
      WHERE COALESCE(la.assigned_to, vm.assigned_to) IS NOT NULL
      GROUP BY vm.list_id, COALESCE(la.assigned_to, vm.assigned_to)
    ) c
    JOIN public.profiles p ON p.id = c.assigned_to
    GROUP BY c.list_id
  ),
  totals AS (
    SELECT list_id,
           count(*)::int AS total,
           count(*) FILTER (WHERE work_status <> 'not_dialable')::int AS dialable,
           count(*) FILTER (WHERE work_status = 'pending')::int      AS pending,
           count(*) FILTER (WHERE work_status = 'worked')::int       AS worked,
           count(*) FILTER (WHERE work_status = 'skipped')::int      AS skipped,
           count(*) FILTER (WHERE work_status = 'not_dialable')::int AS not_dialable,
           max(assigned_at) AS assigned_at
    FROM visible_members
    GROUP BY list_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.pending DESC, x.due_date NULLS LAST), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      ll.id,
      ll.name,
      ll.priority_note,
      ll.due_date,
      COALESCE(t.assigned_at, ll.created_at) AS assigned_at,
      t.total,
      t.dialable,
      t.pending,
      t.worked,
      t.skipped,
      t.not_dialable,
      d.last_call_at,
      COALESCE(d.breakdown, '{}'::jsonb) AS dispositions,
      COALESCE(pc.rows, '[]'::jsonb)     AS by_counsellor,
      (ll.due_date IS NOT NULL AND ll.due_date < current_date AND t.pending > 0) AS overdue
    FROM totals t
    JOIN public.lead_lists ll ON ll.id = t.list_id
    LEFT JOIN dispositions d  ON d.list_id = t.list_id
    LEFT JOIN per_counsellor pc ON pc.list_id = t.list_id
    WHERE p_include_done OR t.pending > 0
  ) x;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.call_list_overview(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_overview(boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
