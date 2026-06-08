-- Add assigned-by filtering to the lead assignment history RPC.
-- Null assigners are historical backfilled rows and are exposed as "System"
-- in the UI.

DROP FUNCTION IF EXISTS public.get_lead_assignment_history(
  int,
  uuid,
  uuid[],
  text[],
  text[],
  text[],
  text[],
  timestamptz,
  timestamptz
);

CREATE OR REPLACE FUNCTION public.get_lead_assignment_history(
  _limit int DEFAULT 100,
  _assigned_to uuid DEFAULT NULL,
  _assigned_to_ids uuid[] DEFAULT NULL,
  _assigned_by_profile_ids uuid[] DEFAULT NULL,
  _include_system_assigned_by boolean DEFAULT false,
  _sources text[] DEFAULT NULL,
  _bucket_names text[] DEFAULT NULL,
  _lead_stages text[] DEFAULT NULL,
  _call_dispositions text[] DEFAULT NULL,
  _from_date timestamptz DEFAULT NULL,
  _to_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  lead_stage text,
  lead_stage_at_assignment text,
  course_name text,
  campus_name text,
  assigned_to uuid,
  assigned_to_name text,
  assigned_by_profile_id uuid,
  assigned_by_name text,
  previous_counsellor_name text,
  assignment_source text,
  bucket_name text,
  latest_call_disposition text,
  latest_call_response text,
  latest_call_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.id INTO v_caller_profile_id
  FROM public.profiles p
  WHERE p.user_id = v_caller_id;

  v_is_admin := has_role(v_caller_id, 'super_admin')
                OR has_role(v_caller_id, 'campus_admin')
                OR has_role(v_caller_id, 'admission_head')
                OR has_role(v_caller_id, 'principal');

  RETURN QUERY
  SELECT
    h.id,
    h.lead_id,
    l.name::text AS lead_name,
    l.phone::text AS lead_phone,
    l.stage::text AS lead_stage,
    h.lead_stage_at_assignment::text,
    c.name::text AS course_name,
    ca.name::text AS campus_name,
    h.assigned_to,
    COALESCE(assignee.display_name, 'Unknown')::text AS assigned_to_name,
    h.assigned_by_profile_id,
    COALESCE(assigner.display_name, 'System')::text AS assigned_by_name,
    previous.display_name::text AS previous_counsellor_name,
    h.assignment_source,
    h.bucket_name,
    latest.disposition::text AS latest_call_disposition,
    latest.response::text AS latest_call_response,
    latest.called_at AS latest_call_at,
    h.created_at
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
      UNION ALL
      SELECT acl.disposition, acl.disposition_notes AS response, acl.created_at AS called_at
      FROM public.ai_call_logs acl
      WHERE acl.lead_id = h.lead_id
    ) x
    WHERE x.disposition IS NOT NULL OR x.response IS NOT NULL
    ORDER BY x.called_at DESC NULLS LAST
    LIMIT 1
  ) latest ON true
  WHERE (_assigned_to IS NULL OR h.assigned_to = _assigned_to)
    AND (
      COALESCE(array_length(_assigned_to_ids, 1), 0) = 0
      OR h.assigned_to = ANY(_assigned_to_ids)
    )
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
    AND (
      (
        COALESCE(array_length(_assigned_by_profile_ids, 1), 0) = 0
        AND NOT COALESCE(_include_system_assigned_by, false)
      )
      OR h.assigned_by_profile_id = ANY(_assigned_by_profile_ids)
      OR (
        COALESCE(_include_system_assigned_by, false)
        AND h.assigned_by_profile_id IS NULL
      )
    )
    AND (
      COALESCE(array_length(_sources, 1), 0) = 0
      OR h.assignment_source = ANY(_sources)
    )
    AND (
      COALESCE(array_length(_bucket_names, 1), 0) = 0
      OR h.bucket_name = ANY(_bucket_names)
    )
    AND (
      COALESCE(array_length(_lead_stages, 1), 0) = 0
      OR l.stage::text = ANY(_lead_stages)
    )
    AND (
      COALESCE(array_length(_call_dispositions, 1), 0) = 0
      OR latest.disposition::text = ANY(_call_dispositions)
    )
    AND (_from_date IS NULL OR h.created_at >= _from_date)
    AND (_to_date IS NULL OR h.created_at < _to_date)
  ORDER BY h.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_assignment_history(
  int,
  uuid,
  uuid[],
  uuid[],
  boolean,
  text[],
  text[],
  text[],
  text[],
  timestamptz,
  timestamptz
) TO authenticated;

NOTIFY pgrst, 'reload schema';
