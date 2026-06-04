-- Follow-up for counsellor hot paths found during authenticated RLS smoke test.
-- Keep SECURITY INVOKER so table RLS remains in force, but avoid OR-scoped
-- predicates that make Postgres scan large tables for counsellor badge counts.

GRANT SELECT ON public.source_sla_config TO authenticated;

CREATE OR REPLACE FUNCTION public.action_badge_counts(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_include_unassigned boolean DEFAULT true
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
  v_include_unassigned boolean;
  v_today_start timestamptz := date_trunc('day', now());
  v_tomorrow_start timestamptz := date_trunc('day', now()) + interval '1 day';
  v_overdue integer := 0;
  v_today integer := 0;
  v_fresh integer := 0;
  v_new_leads_total integer := 0;
  v_unassigned integer := 0;
  v_unclosed integer := 0;
  v_confirm integer := 0;
  v_post_visit integer := 0;
  v_ai_needs_followup integer := 0;
  v_missed_callbacks integer := 0;
  v_hot integer := 0;
  v_priority_interested_total integer := 0;
  v_wa_unread integer := 0;
  v_reclaim_soon integer := 0;
  v_tat_defaults integer := 0;
BEGIN
  v_role_name := public.get_user_role(auth.uid())::text;

  SELECT p.id INTO v_own_profile_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_role_name = 'counsellor' THEN
    v_scope_counsellor_id := v_own_profile_id;
    v_include_unassigned := false;
  ELSE
    v_scope_counsellor_id := p_scope_counsellor_id;
    v_include_unassigned := COALESCE(p_include_unassigned, true);
  END IF;

  IF v_scope_counsellor_id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_overdue
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at < now()
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_today
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at >= v_today_start
      AND lf.scheduled_at < v_tomorrow_start
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_fresh
    FROM public.leads l
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_new_leads_total
    FROM public.leads l
    WHERE l.stage = 'new_lead'
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_unclosed
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_confirm
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_post_visit
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
      AND l.counsellor_id = v_scope_counsellor_id
      AND NOT EXISTS (
        SELECT 1 FROM public.call_logs cl
        WHERE cl.lead_id = cv.lead_id
          AND cl.called_at > cv.visit_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_followups lf
        WHERE lf.lead_id = cv.lead_id
          AND lf.status = 'completed'
          AND lf.completed_at > cv.visit_date
      );

    SELECT COUNT(*)::integer INTO v_ai_needs_followup
    FROM public.ai_call_records acr
    JOIN public.leads l ON l.id = acr.lead_id
    WHERE acr.needs_followup = true
      AND acr.followup_done_at IS NULL
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_missed_callbacks
    FROM public.call_logs cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.direction = 'inbound'
      AND cl.disposition = 'missed'
      AND l.counsellor_id = v_scope_counsellor_id;

    SELECT COUNT(*)::integer INTO v_hot
    FROM public.leads l
    WHERE l.stage = 'priority_interested'
      AND l.counsellor_id = v_scope_counsellor_id;

    v_priority_interested_total := v_hot;

    SELECT COUNT(*)::integer INTO v_wa_unread
    FROM public.whatsapp_messages wm
    JOIN public.leads l ON l.id = wm.lead_id
    WHERE wm.direction = 'inbound'
      AND wm.is_read = false
      AND l.counsellor_id = v_scope_counsellor_id;

    v_reclaim_soon := public.fn_count_leads_reclaim_soon(v_scope_counsellor_id, 30);
  ELSE
    SELECT COUNT(*)::integer INTO v_overdue
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at < now()
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');

    SELECT COUNT(*)::integer INTO v_today
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at >= v_today_start
      AND lf.scheduled_at < v_tomorrow_start
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');

    SELECT COUNT(*)::integer INTO v_fresh
    FROM public.leads l
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL;

    SELECT COUNT(*)::integer INTO v_new_leads_total
    FROM public.leads l
    WHERE l.stage = 'new_lead';

    IF v_include_unassigned THEN
      SELECT COUNT(*)::integer INTO v_unassigned
      FROM public.leads l
      WHERE l.stage = 'new_lead'
        AND l.counsellor_id IS NULL;
    END IF;

    SELECT COUNT(*)::integer INTO v_unclosed
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7;

    SELECT COUNT(*)::integer INTO v_confirm
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1;

    SELECT COUNT(*)::integer INTO v_post_visit
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.call_logs cl
        WHERE cl.lead_id = cv.lead_id
          AND cl.called_at > cv.visit_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_followups lf
        WHERE lf.lead_id = cv.lead_id
          AND lf.status = 'completed'
          AND lf.completed_at > cv.visit_date
      );

    SELECT COUNT(*)::integer INTO v_ai_needs_followup
    FROM public.ai_call_records acr
    JOIN public.leads l ON l.id = acr.lead_id
    WHERE acr.needs_followup = true
      AND acr.followup_done_at IS NULL;

    SELECT COUNT(*)::integer INTO v_missed_callbacks
    FROM public.call_logs cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.direction = 'inbound'
      AND cl.disposition = 'missed';

    SELECT COUNT(*)::integer INTO v_priority_interested_total
    FROM public.leads l
    WHERE l.stage = 'priority_interested';

    SELECT COUNT(*)::integer INTO v_wa_unread
    FROM public.whatsapp_messages wm
    WHERE wm.direction = 'inbound'
      AND wm.is_read = false;
  END IF;

  IF v_role_name = 'counsellor' THEN
    SELECT COALESCE(ctd.total_defaults, 0)::integer INTO v_tat_defaults
    FROM public.counsellor_tat_defaults ctd
    WHERE ctd.user_id = auth.uid()
    LIMIT 1;
    v_tat_defaults := COALESCE(v_tat_defaults, 0);
  ELSE
    SELECT COALESCE(SUM(ctd.total_defaults), 0)::integer INTO v_tat_defaults
    FROM public.counsellor_tat_defaults ctd;
  END IF;

  RETURN jsonb_build_object(
    'overdue', v_overdue,
    'today', v_today,
    'fresh', v_fresh,
    'new_leads_total', v_new_leads_total,
    'unassigned', v_unassigned,
    'unclosed', v_unclosed,
    'confirm', v_confirm,
    'post_visit', v_post_visit,
    'ai_needs_followup', v_ai_needs_followup,
    'missed_callbacks', v_missed_callbacks,
    'hot', v_hot,
    'priority_interested_total', v_priority_interested_total,
    'wa_unread', v_wa_unread,
    'reclaim_soon', v_reclaim_soon,
    'tat_defaults', v_tat_defaults
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated;

-- Ensure PostgREST refreshes the new function signatures/grants promptly.
NOTIFY pgrst, 'reload schema';
