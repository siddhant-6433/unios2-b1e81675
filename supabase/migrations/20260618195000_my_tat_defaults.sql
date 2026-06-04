-- Lightweight current-counsellor TAT breakdown for page banners.
-- Avoid selecting the full counsellor_tat_defaults view on every dashboard mount.

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
  WHERE lf.status = 'pending'
    AND lf.scheduled_at < now()
    AND l.counsellor_id = v_scope_counsellor_id
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested');

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
