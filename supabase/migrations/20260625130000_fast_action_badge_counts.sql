-- Fast path for CRM chrome badge counts.
--
-- Root cause from pg_stat_statements: action_badge_counts was the top database
-- consumer (~4.9s mean over 2.3k calls). The current implementation calls the
-- older base function, recomputes follow-up buckets, then recomputes WhatsApp
-- unreplied counts. That keeps permissions intact, but turns every mounted CRM
-- sidebar/header into repeated scans over lead/WhatsApp tables.
--
-- This migration keeps the same SECURITY INVOKER boundary and authenticated
-- execute grant. It does not alter RLS policies or table grants.

CREATE INDEX IF NOT EXISTS idx_leads_counsellor_stage_badge_counts
  ON public.leads (counsellor_id, stage)
  INCLUDE (id, first_contact_at, assigned_at);

CREATE INDEX IF NOT EXISTS idx_lead_followups_pending_lead_scheduled
  ON public.lead_followups (lead_id, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_lead_followups_completed_lead_completed
  ON public.lead_followups (lead_id, completed_at)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_call_logs_lead_called_at
  ON public.call_logs (lead_id, called_at);

CREATE INDEX IF NOT EXISTS idx_campus_visits_lead_status_visit_date
  ON public.campus_visits (lead_id, status, visit_date);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unread_phone_conversation_created
  ON public.whatsapp_messages (
    phone,
    public.whatsapp_conversation_key(provider, business_phone_number_id, business_phone_number),
    created_at
  )
  WHERE direction = 'inbound' AND is_read = false;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_outbound_phone_conversation_created
  ON public.whatsapp_messages (
    phone,
    public.whatsapp_conversation_key(provider, business_phone_number_id, business_phone_number),
    created_at
  )
  WHERE direction = 'outbound';

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
  v_enforce_overdue boolean := public.get_overdue_followup_enforcement_enabled();
  v_today_start timestamptz := date_trunc('day', now());
  v_current_time timestamptz := now();
  v_overdue_raw integer := 0;
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
  v_new_leads_overdue integer := 0;
  v_app_checkins_overdue integer := 0;
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
    SELECT
      COUNT(*) FILTER (WHERE l.stage = 'new_lead' AND l.first_contact_at IS NULL)::integer,
      COUNT(*) FILTER (WHERE l.stage = 'new_lead')::integer,
      COUNT(*) FILTER (WHERE l.stage = 'priority_interested')::integer
    INTO v_fresh, v_new_leads_total, v_hot
    FROM public.leads l
    WHERE l.counsellor_id = v_scope_counsellor_id;

    v_priority_interested_total := v_hot;

    SELECT
      COUNT(*) FILTER (WHERE lf.scheduled_at < v_today_start)::integer,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= v_today_start AND lf.scheduled_at <= v_current_time)::integer
    INTO v_overdue_raw, v_today
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND l.counsellor_id = v_scope_counsellor_id
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');

    v_overdue := CASE WHEN v_enforce_overdue THEN COALESCE(v_overdue_raw, 0) ELSE 0 END;

    SELECT COUNT(*)::integer INTO v_unclosed
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7;

    SELECT COUNT(*)::integer INTO v_confirm
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1;

    SELECT COUNT(*)::integer INTO v_post_visit
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.call_logs cl
        WHERE cl.lead_id = cv.lead_id
          AND cl.called_at > cv.visit_date
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_followups lf_done
        WHERE lf_done.lead_id = cv.lead_id
          AND lf_done.status = 'completed'
          AND lf_done.completed_at > cv.visit_date
      );

    SELECT COUNT(*)::integer INTO v_ai_needs_followup
    FROM public.ai_call_records acr
    JOIN public.leads l ON l.id = acr.lead_id
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND acr.needs_followup = true
      AND acr.followup_done_at IS NULL;

    SELECT COUNT(*)::integer INTO v_missed_callbacks
    FROM public.call_logs cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND cl.direction = 'inbound'
      AND cl.disposition = 'missed';

    SELECT COUNT(*)::integer INTO v_wa_unread
    FROM public.whatsapp_messages wm
    JOIN public.leads l ON l.id = wm.lead_id
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND wm.direction = 'inbound'
      AND wm.is_read = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_messages replied
        WHERE replied.phone = wm.phone
          AND replied.direction = 'outbound'
          AND replied.created_at > wm.created_at
          AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
            = public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number)
      );

    v_reclaim_soon := public.fn_count_leads_reclaim_soon(v_scope_counsellor_id, 30);

    SELECT COUNT(*)::integer INTO v_new_leads_overdue
    FROM public.leads l
    JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND l.first_contact_at IS NULL
      AND l.assigned_at IS NOT NULL
      AND l.counsellor_id IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 > sc.first_contact_hours
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

    v_tat_defaults := COALESCE(v_new_leads_overdue, 0) + COALESCE(v_overdue, 0) + COALESCE(v_app_checkins_overdue, 0);
  ELSE
    SELECT
      COUNT(*) FILTER (WHERE l.stage = 'new_lead' AND l.first_contact_at IS NULL)::integer,
      COUNT(*) FILTER (WHERE l.stage = 'new_lead')::integer,
      COUNT(*) FILTER (WHERE l.stage = 'priority_interested')::integer
    INTO v_fresh, v_new_leads_total, v_priority_interested_total
    FROM public.leads l;

    IF v_include_unassigned THEN
      SELECT COUNT(*)::integer INTO v_unassigned
      FROM public.leads l
      WHERE l.stage = 'new_lead'
        AND l.counsellor_id IS NULL;
    END IF;

    SELECT
      COUNT(*) FILTER (WHERE lf.scheduled_at < v_today_start)::integer,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= v_today_start AND lf.scheduled_at <= v_current_time)::integer
    INTO v_overdue_raw, v_today
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');

    v_overdue := CASE WHEN v_enforce_overdue THEN COALESCE(v_overdue_raw, 0) ELSE 0 END;

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
        SELECT 1
        FROM public.call_logs cl
        WHERE cl.lead_id = cv.lead_id
          AND cl.called_at > cv.visit_date
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_followups lf_done
        WHERE lf_done.lead_id = cv.lead_id
          AND lf_done.status = 'completed'
          AND lf_done.completed_at > cv.visit_date
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

    SELECT COUNT(*)::integer INTO v_wa_unread
    FROM public.whatsapp_messages wm
    LEFT JOIN public.leads l ON l.id = wm.lead_id
    WHERE wm.direction = 'inbound'
      AND wm.is_read = false
      AND (
        v_include_unassigned = true
        OR l.counsellor_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_messages replied
        WHERE replied.phone = wm.phone
          AND replied.direction = 'outbound'
          AND replied.created_at > wm.created_at
          AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
            = public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number)
      );
  END IF;

  RETURN jsonb_build_object(
    'overdue', COALESCE(v_overdue, 0),
    'today', COALESCE(v_today, 0),
    'fresh', COALESCE(v_fresh, 0),
    'new_leads_total', COALESCE(v_new_leads_total, 0),
    'unassigned', COALESCE(v_unassigned, 0),
    'unclosed', COALESCE(v_unclosed, 0),
    'confirm', COALESCE(v_confirm, 0),
    'post_visit', COALESCE(v_post_visit, 0),
    'ai_needs_followup', COALESCE(v_ai_needs_followup, 0),
    'missed_callbacks', COALESCE(v_missed_callbacks, 0),
    'hot', COALESCE(v_hot, 0),
    'priority_interested_total', COALESCE(v_priority_interested_total, 0),
    'wa_unread', COALESCE(v_wa_unread, 0),
    'reclaim_soon', COALESCE(v_reclaim_soon, 0),
    'tat_defaults', COALESCE(v_tat_defaults, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
