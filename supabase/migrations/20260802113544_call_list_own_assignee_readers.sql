-- Assigner-facing readers follow the same attribution rule as the trigger:
-- a call list only reports calls placed by its own assignee.
-- See 20260802113502 for the full rationale and the deliberate tradeoff.

-- ── 3. Assigner rollup: same attribution rule ────────────────────────────────

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
  -- Floored on assigned_at (no previous-cycle calls) AND matched to the
  -- member's own assignee (no other counsellor's call showing as this list's
  -- outcome).
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
           count(*) FILTER (WHERE work_status = 'skipped')::int AS skipped,
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

-- ── 4. Per-lead Calling Report: the human-call branch follows the assignee ───
-- The AI-call branch is deliberately left in place: it is a per-lead
-- "latest contact" display column, not a counted outcome, and an AI call is
-- never attributable to a counsellor. Time floor still applies to both.

CREATE OR REPLACE FUNCTION public.get_lead_list_assignment_report(
  _list_id uuid,
  _batch_id uuid DEFAULT NULL,
  _limit integer DEFAULT 500
)
RETURNS TABLE (
  assignment_id uuid,
  batch_id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  lead_stage text,
  course_name text,
  campus_name text,
  assigned_to uuid,
  assigned_to_name text,
  assigned_by_name text,
  previous_counsellor_name text,
  latest_call_disposition text,
  latest_call_response text,
  latest_call_at timestamptz,
  assigned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_user_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
BEGIN
  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.id INTO v_caller_profile_id
  FROM public.profiles p
  WHERE p.user_id = v_caller_user_id
  LIMIT 1;

  v_is_admin := public.has_role(v_caller_user_id, 'super_admin'::public.app_role)
                OR public.has_role(v_caller_user_id, 'admission_head'::public.app_role)
                OR public.has_role(v_caller_user_id, 'principal'::public.app_role);

  RETURN QUERY
  SELECT
    h.id AS assignment_id,
    h.list_assignment_batch_id AS batch_id,
    h.lead_id,
    l.name::text AS lead_name,
    l.phone::text AS lead_phone,
    l.stage::text AS lead_stage,
    c.name::text AS course_name,
    ca.name::text AS campus_name,
    h.assigned_to,
    COALESCE(assignee.display_name, 'Unknown')::text AS assigned_to_name,
    COALESCE(assigner.display_name, 'System')::text AS assigned_by_name,
    previous.display_name::text AS previous_counsellor_name,
    latest.disposition::text AS latest_call_disposition,
    latest.response::text AS latest_call_response,
    latest.called_at AS latest_call_at,
    h.created_at AS assigned_at
  FROM public.lead_assignment_history h
  JOIN public.leads l ON l.id = h.lead_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.campuses ca ON ca.id = l.campus_id
  LEFT JOIN public.profiles assignee ON assignee.id = h.assigned_to
  LEFT JOIN public.profiles assigner ON assigner.id = h.assigned_by_profile_id
  LEFT JOIN public.profiles previous ON previous.id = h.previous_counsellor_id
  LEFT JOIN LATERAL (
    SELECT x.disposition, x.response, x.called_at
    FROM (
      SELECT cl.disposition, cl.notes AS response, cl.called_at
      FROM public.call_logs cl
      WHERE cl.lead_id = h.lead_id
        AND cl.called_at >= h.created_at
        -- Only the counsellor this row was assigned to.
        AND cl.user_id = assignee.user_id
      UNION ALL
      SELECT acl.disposition, acl.disposition_notes AS response, acl.created_at AS called_at
      FROM public.ai_call_logs acl
      WHERE acl.lead_id = h.lead_id
        AND acl.created_at >= h.created_at
    ) x
    WHERE x.disposition IS NOT NULL OR x.response IS NOT NULL
    ORDER BY x.called_at DESC NULLS LAST
    LIMIT 1
  ) latest ON true
  WHERE h.list_id = _list_id
    AND (_batch_id IS NULL OR h.list_assignment_batch_id = _batch_id)
    AND (
      v_is_admin
      OR h.assigned_to = v_caller_profile_id
      OR EXISTS (
        SELECT 1
        FROM public.teams t
        JOIN public.team_members tm ON tm.team_id = t.id
        JOIN public.profiles member ON member.user_id = tm.user_id
        WHERE t.leader_id = v_caller_profile_id
          AND member.id = h.assigned_to
      )
    )
  ORDER BY h.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 500), 1000));
END;
$$;

REVOKE ALL ON FUNCTION public.get_lead_list_assignment_report(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_list_assignment_report(uuid, uuid, integer) TO authenticated;
