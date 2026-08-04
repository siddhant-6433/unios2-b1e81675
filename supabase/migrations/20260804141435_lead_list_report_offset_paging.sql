-- lead list report offset paging
--
-- The Calling Report CSV export must dump the WHOLE list, but
-- get_lead_list_assignment_report(uuid,uuid,integer) hard-caps at 1000 rows
-- (LIMIT ... 1000) with no way to page past it — a silent truncation on any
-- large list. Add a 4-arg overload that takes _offset so the client can page
-- (1000 rows per call) until a short page returns. The 3-arg version the report
-- dialog uses is untouched. Body is identical apart from the OFFSET clause.

CREATE OR REPLACE FUNCTION public.get_lead_list_assignment_report(
  _list_id uuid,
  _batch_id uuid,
  _limit integer,
  _offset integer
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
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 1000), 1000))
  OFFSET GREATEST(0, COALESCE(_offset, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.get_lead_list_assignment_report(uuid, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_list_assignment_report(uuid, uuid, integer, integer) TO authenticated;
