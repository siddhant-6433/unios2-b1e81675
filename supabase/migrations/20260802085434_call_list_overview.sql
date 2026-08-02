-- "Are the lists I handed out actually being called, and what came back?"
--
-- call_list_progress() answers that for ONE list and only counts worked/pending.
-- An assigner (super_admin / principal / admission_head / team leader) needs the
-- answer for every live list at a glance, with the call outcomes attached —
-- otherwise they have to open Marketing Hub → Lists → Calling Report per list.
--
-- Everything is aggregated server-side: a client-side rollup over
-- lead_list_members would hit the 1000-row response cap on any list worth
-- assigning.

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
    SELECT m.list_id, m.lead_id, m.assigned_to, m.work_status, m.worked_at, m.call_log_id
    FROM public.lead_list_members m
    JOIN public.lead_lists ll ON ll.id = m.list_id
    WHERE ll.purpose = 'calling'
      AND ll.is_active
      -- Team leaders see only the lists their own members are working.
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
  -- Latest call per worked member. Pending members deliberately contribute no
  -- disposition: any call_logs row they have predates the assignment, and
  -- showing it would read as "already handled".
  latest_call AS (
    SELECT DISTINCT ON (vm.list_id, vm.lead_id)
      vm.list_id,
      vm.lead_id,
      cl.disposition,
      cl.called_at
    FROM visible_members vm
    JOIN public.call_logs cl ON cl.lead_id = vm.lead_id
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
      SELECT list_id, assigned_to,
             count(*)::int AS total,
             count(*) FILTER (WHERE work_status = 'worked')::int AS worked,
             count(*) FILTER (WHERE work_status = 'pending')::int AS pending
      FROM visible_members
      WHERE assigned_to IS NOT NULL
      GROUP BY list_id, assigned_to
    ) c
    JOIN public.profiles p ON p.id = c.assigned_to
    GROUP BY c.list_id
  ),
  totals AS (
    SELECT list_id,
           count(*)::int AS total,
           count(*) FILTER (WHERE work_status = 'pending')::int AS pending,
           count(*) FILTER (WHERE work_status = 'worked')::int  AS worked,
           count(*) FILTER (WHERE work_status = 'skipped')::int AS skipped
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
      ll.created_at AS assigned_at,
      t.total,
      t.pending,
      t.worked,
      t.skipped,
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

COMMENT ON FUNCTION public.call_list_overview(boolean) IS
  'Assigner-facing rollup of every active call list: progress, per-counsellor split, and the disposition breakdown of the calls made. Admins see all lists; team leaders see lists their own members hold.';

-- call_list_progress() gains the same disposition breakdown so the per-list
-- Calling Report and the dashboard panel agree on what "call updates" means.
CREATE OR REPLACE FUNCTION public.call_list_progress(p_list_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT * FROM public.lead_list_members m WHERE m.list_id = p_list_id
  ),
  latest_call AS (
    SELECT DISTINCT ON (m.lead_id) m.lead_id, cl.disposition, cl.called_at
    FROM members m
    JOIN public.call_logs cl ON cl.lead_id = m.lead_id
    WHERE m.work_status = 'worked'
    ORDER BY m.lead_id, cl.called_at DESC
  )
  SELECT jsonb_build_object(
    'list_id', p_list_id,
    'total',   (SELECT count(*)::int FROM members),
    'pending', (SELECT count(*) FILTER (WHERE work_status = 'pending')::int FROM members),
    'worked',  (SELECT count(*) FILTER (WHERE work_status = 'worked')::int  FROM members),
    'skipped', (SELECT count(*) FILTER (WHERE work_status = 'skipped')::int FROM members),
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
               count(*)::int AS total,
               count(*) FILTER (WHERE m2.work_status = 'worked')::int  AS worked,
               count(*) FILTER (WHERE m2.work_status = 'pending')::int AS pending
        FROM members m2
        WHERE m2.assigned_to IS NOT NULL
        GROUP BY m2.assigned_to
      ) c
      JOIN public.profiles p ON p.id = c.assigned_to
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.call_list_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_progress(uuid) TO authenticated;
