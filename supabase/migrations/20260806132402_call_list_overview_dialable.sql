-- The assigner rollup (call_list_overview) never got the not_dialable split.
--
-- The not_dialable work_status was introduced in 20260802115927, which taught
-- call_list_progress and my_call_lists to report `dialable` (total minus
-- not_dialable — the honest denominator) and `not_dialable` separately. But
-- call_list_overview — the RPC behind the dashboard "Assigned call lists" panel
-- — was last redefined in 20260802113544, before that split, and no later
-- migration re-created it. So it kept returning only total/pending/worked.
--
-- The frontend (CallListProgressPanel + LeadLists) was already written to read
-- `dialable` and `not_dialable`, falling back to `total` when they are absent.
-- Result on screen: "16/222 called · 66 pending" — 222 counts the 140
-- not_dialable members (no phone / terminal stage at hand-off) in the
-- denominator but correctly excludes them from pending, so the numbers can't
-- reconcile. Honest arithmetic: dialable(82) = worked(16) + pending(66); the
-- other 140 are not_dialable.
--
-- This recreates call_list_overview identically to 20260802113544 plus the two
-- fields, and aligns the per-counsellor `total` to the dialable count the way
-- call_list_progress / my_call_lists already do. No frontend change needed.

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
             -- dialable count, so worked/total reconciles with worked+pending.
             count(*) FILTER (WHERE work_status <> 'not_dialable')::int AS total,
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
           -- dialable is the honest denominator: what the counsellor can work.
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
