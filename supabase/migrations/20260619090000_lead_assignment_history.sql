-- Lead assignment audit trail for counsellor/TL/admin dashboards.
-- Records assignment events at the existing claim_leads RPC choke point and
-- exposes a scoped SECURITY DEFINER reader with current lead status plus the
-- latest manual/AI call disposition.

CREATE TABLE IF NOT EXISTS public.lead_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.profiles(id),
  previous_counsellor_id uuid REFERENCES public.profiles(id),
  assigned_by_profile_id uuid REFERENCES public.profiles(id),
  assigned_by_user_id uuid REFERENCES auth.users(id),
  assignment_source text NOT NULL DEFAULT 'assigned'
    CHECK (assignment_source IN ('self_picked', 'assigned')),
  bucket_name text,
  lead_stage_at_assignment public.lead_stage NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_assignment_history_created
  ON public.lead_assignment_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_assignment_history_assigned_to_created
  ON public.lead_assignment_history (assigned_to, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_assignment_history_lead_created
  ON public.lead_assignment_history (lead_id, created_at DESC);

ALTER TABLE public.lead_assignment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view lead assignment history"
  ON public.lead_assignment_history
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
    OR public.has_role(auth.uid(), 'principal')
  );

CREATE POLICY "Counsellors can view own lead assignment history"
  ON public.lead_assignment_history
  FOR SELECT TO authenticated
  USING (
    assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1)
  );

CREATE POLICY "Team leaders can view team lead assignment history"
  ON public.lead_assignment_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles leader
      JOIN public.teams t ON t.leader_id = leader.id
      JOIN public.team_members tm ON tm.team_id = t.id
      JOIN public.profiles member ON member.user_id = tm.user_id
      WHERE leader.user_id = auth.uid()
        AND member.id = lead_assignment_history.assigned_to
    )
  );

GRANT SELECT ON public.lead_assignment_history TO authenticated;
GRANT ALL ON public.lead_assignment_history TO service_role;

CREATE OR REPLACE FUNCTION public.claim_leads(
  _lead_ids uuid[],
  _assign_to uuid
)
RETURNS TABLE (
  assigned_count int,
  failed_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
  v_is_counsellor boolean;
  v_assigned int := 0;
  v_failed int := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _assign_to IS NULL THEN
    RAISE EXCEPTION 'Target counsellor is required';
  END IF;

  v_is_admin := has_role(v_caller_id, 'super_admin')
                OR has_role(v_caller_id, 'campus_admin')
                OR has_role(v_caller_id, 'admission_head')
                OR has_role(v_caller_id, 'principal');
  v_is_counsellor := has_role(v_caller_id, 'counsellor');

  IF NOT (v_is_admin OR v_is_counsellor) THEN
    RAISE EXCEPTION 'Insufficient permissions to claim leads';
  END IF;

  SELECT id INTO v_caller_profile_id
  FROM public.profiles
  WHERE user_id = v_caller_id;

  IF v_is_counsellor AND NOT v_is_admin THEN
    IF _assign_to IS DISTINCT FROM v_caller_profile_id THEN
      RAISE EXCEPTION 'Counsellors can only self-assign leads';
    END IF;
  END IF;

  WITH bucket_rows AS (
    SELECT
      ub.id,
      CASE
        WHEN ub.bucket = 'college' THEN 'College Leads'
        WHEN ub.school_brand = 'mirai' THEN 'Mirai IB Leads'
        WHEN ub.bucket = 'school' THEN 'CBSE School Leads'
        ELSE NULL
      END AS bucket_name
    FROM public.get_unassigned_leads_bucket() ub
    WHERE ub.id = ANY(_lead_ids)
  ),
  candidates AS (
    SELECT
      l.id,
      l.counsellor_id AS previous_counsellor_id,
      l.stage AS lead_stage_at_assignment,
      br.bucket_name
    FROM public.leads l
    LEFT JOIN bucket_rows br ON br.id = l.id
    WHERE l.id = ANY(_lead_ids)
      AND (v_is_admin OR l.counsellor_id IS NULL)
      AND l.counsellor_id IS DISTINCT FROM _assign_to
  ),
  updated AS (
    UPDATE public.leads l
    SET counsellor_id = _assign_to
    FROM candidates c
    WHERE l.id = c.id
    RETURNING l.id
  ),
  history_insert AS (
    INSERT INTO public.lead_assignment_history (
      lead_id,
      assigned_to,
      previous_counsellor_id,
      assigned_by_profile_id,
      assigned_by_user_id,
      assignment_source,
      bucket_name,
      lead_stage_at_assignment
    )
    SELECT
      c.id,
      _assign_to,
      c.previous_counsellor_id,
      v_caller_profile_id,
      v_caller_id,
      CASE
        WHEN NOT v_is_admin
          AND c.previous_counsellor_id IS NULL
          AND _assign_to = v_caller_profile_id
        THEN 'self_picked'
        ELSE 'assigned'
      END,
      c.bucket_name,
      c.lead_stage_at_assignment
    FROM candidates c
    JOIN updated u ON u.id = c.id
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_assigned FROM history_insert;

  v_failed := COALESCE(array_length(_lead_ids, 1), 0) - v_assigned;

  RETURN QUERY SELECT v_assigned, v_failed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_leads(uuid[], uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_lead_assignment_history(
  _limit int DEFAULT 100,
  _assigned_to uuid DEFAULT NULL
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
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_assignment_history(int, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
