-- keep-migration-version: already recorded on production schema_migrations
-- crm recovery visit states and history access

GRANT SELECT ON public.lead_followup_owner_history TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_manager_recovery_snapshot(
  p_limit integer DEFAULT 100,
  p_scope_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_is_manager boolean;
  v_rows jsonb;
  v_counts jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  v_is_manager := public.has_role(v_user_id, 'super_admin') OR
    public.has_role(v_user_id, 'campus_admin') OR public.has_role(v_user_id, 'principal') OR
    public.has_role(v_user_id, 'vice_principal') OR public.has_role(v_user_id, 'admission_head');
  IF NOT v_is_manager AND NOT public.has_role(v_user_id, 'counsellor') THEN
    RAISE EXCEPTION 'CRM recovery access required' USING ERRCODE = '42501';
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = v_user_id LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Counsellor profile not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT v_is_manager THEN p_scope_counsellor_id := v_profile_id; END IF;

  WITH latest_visit AS MATERIALIZED (
    SELECT DISTINCT ON (cv.lead_id) cv.lead_id, cv.status, cv.visit_date
    FROM public.campus_visits cv
    ORDER BY cv.lead_id, cv.visit_date DESC, cv.updated_at DESC
  ),
  scoped_leads AS MATERIALIZED (
    SELECT l.id, l.name, l.phone, l.stage::text AS stage, l.source::text AS source,
      l.lead_score, l.lead_temperature, l.counsellor_id, owner.display_name AS owner_name,
      l.created_at, l.assigned_at, l.first_contact_at, l.campus_id, l.course_id,
      sla.first_contact_hours,
      COALESCE(lv.status IN ('scheduled', 'confirmed') AND lv.visit_date < now(), false) AS visit_outcome_overdue,
      COALESCE(lv.status = 'completed' AND lv.visit_date < now() - interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM public.call_logs cl WHERE cl.lead_id = l.id AND cl.called_at > lv.visit_date)
        AND NOT EXISTS (SELECT 1 FROM public.lead_followups done WHERE done.lead_id = l.id
          AND done.status = 'completed' AND done.completed_at > lv.visit_date), false) AS post_visit_overdue
    FROM public.leads l
    LEFT JOIN public.profiles owner ON owner.id = l.counsellor_id
    LEFT JOIN public.source_sla_config sla ON sla.source = l.source::text
    LEFT JOIN latest_visit lv ON lv.lead_id = l.id
    WHERE l.archived_at IS NULL
      AND l.stage::text NOT IN ('admitted', 'rejected', 'not_interested', 'ineligible', 'dnc', 'deferred', 'duplicate', 'course_not_available')
      AND (p_scope_counsellor_id IS NULL OR l.counsellor_id = p_scope_counsellor_id)
  ),
  pending_action AS (
    SELECT DISTINCT ON (lf.lead_id) lf.lead_id, lf.id, lf.type, lf.scheduled_at, lf.notes
    FROM public.lead_followups lf JOIN scoped_leads sl ON sl.id = lf.lead_id
    WHERE lf.status = 'pending'
    ORDER BY lf.lead_id, lf.scheduled_at, lf.created_at
  ),
  classified AS (
    SELECT sl.*, pa.id AS action_id, pa.type AS action_type, pa.scheduled_at AS action_due_at, pa.notes AS action_notes,
      CASE
        WHEN sl.counsellor_id IS NULL THEN 'unassigned'
        WHEN sl.stage = 'new_lead' AND sl.first_contact_at IS NULL AND sl.assigned_at IS NOT NULL
          AND now() > sl.assigned_at + make_interval(hours => COALESCE(sl.first_contact_hours, 4)) THEN 'fresh_sla_breached'
        WHEN sl.lead_temperature = 'hot' AND sl.first_contact_at IS NULL THEN 'hot_untouched'
        WHEN sl.visit_outcome_overdue THEN 'overdue_visit_outcome'
        WHEN sl.post_visit_overdue THEN 'overdue_post_visit'
        WHEN pa.scheduled_at < now() - interval '3 days' THEN 'overdue_over_3_days'
        WHEN pa.scheduled_at < now() - interval '1 day' THEN 'overdue_1_to_3_days'
        WHEN pa.scheduled_at < now() THEN 'overdue_under_1_day'
        WHEN sl.phone IS NULL OR btrim(sl.phone) = '' THEN 'no_contact_channel'
        WHEN pa.id IS NULL THEN 'missing_next_action'
        ELSE NULL
      END AS recovery_reason
    FROM scoped_leads sl LEFT JOIN pending_action pa ON pa.lead_id = sl.id
  ),
  recovery AS (SELECT * FROM classified WHERE recovery_reason IS NOT NULL),
  count_by_reason AS (SELECT recovery_reason AS reason, count(*)::integer AS n FROM recovery GROUP BY recovery_reason),
  reason_keys(reason) AS (VALUES
    ('unassigned'), ('fresh_sla_breached'), ('hot_untouched'), ('overdue_visit_outcome'),
    ('overdue_post_visit'), ('overdue_over_3_days'), ('overdue_1_to_3_days'),
    ('overdue_under_1_day'), ('no_contact_channel'), ('missing_next_action')
  ),
  summary AS (
    SELECT jsonb_object_agg(k.reason, COALESCE(c.n, 0)) AS counts
    FROM reason_keys k LEFT JOIN count_by_reason c ON c.reason = k.reason
  ),
  items AS (
    SELECT jsonb_agg(to_jsonb(r) ORDER BY
      CASE r.recovery_reason
        WHEN 'unassigned' THEN 1 WHEN 'fresh_sla_breached' THEN 2 WHEN 'hot_untouched' THEN 3
        WHEN 'overdue_visit_outcome' THEN 4 WHEN 'overdue_post_visit' THEN 5
        WHEN 'overdue_over_3_days' THEN 6 WHEN 'overdue_1_to_3_days' THEN 7
        WHEN 'overdue_under_1_day' THEN 8 WHEN 'no_contact_channel' THEN 9 ELSE 10 END,
      COALESCE(r.action_due_at, r.assigned_at, r.created_at) ASC) AS rows
    FROM (SELECT * FROM recovery ORDER BY
      CASE recovery_reason
        WHEN 'unassigned' THEN 1 WHEN 'fresh_sla_breached' THEN 2 WHEN 'hot_untouched' THEN 3
        WHEN 'overdue_visit_outcome' THEN 4 WHEN 'overdue_post_visit' THEN 5
        WHEN 'overdue_over_3_days' THEN 6 WHEN 'overdue_1_to_3_days' THEN 7
        WHEN 'overdue_under_1_day' THEN 8 WHEN 'no_contact_channel' THEN 9 ELSE 10 END,
      COALESCE(action_due_at, assigned_at, created_at) ASC
      LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))) r
  )
  SELECT summary.counts, COALESCE(items.rows, '[]'::jsonb) INTO v_counts, v_rows
  FROM summary CROSS JOIN items;

  RETURN jsonb_build_object('as_of', now(), 'timezone', 'Asia/Kolkata',
    'scope_counsellor_id', p_scope_counsellor_id, 'counts', v_counts, 'items', v_rows);
END;
$$;
