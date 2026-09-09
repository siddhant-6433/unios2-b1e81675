-- Denormalize last WhatsApp message direction onto conversation_state so
-- pending-reply counts are a COUNT(*) on ~40k rows instead of aggregating
-- every whatsapp_messages row (~4s, 8s timeouts). Inbox chips and the action
-- bar "WhatsApp Unreplied" chip both read pending conversations (last inbound,
-- lead not DNC), not unread-message scans.

ALTER TABLE public.whatsapp_conversation_state
  ADD COLUMN IF NOT EXISTS last_direction text
    CHECK (last_direction IS NULL OR last_direction IN ('inbound', 'outbound')),
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS has_inbound boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_business_phone_number_id text;

COMMENT ON COLUMN public.whatsapp_conversation_state.last_direction IS
  'Direction of the latest whatsapp_messages row for this phone+channel. Source for pending-reply counts.';

CREATE INDEX IF NOT EXISTS idx_wcs_pending_reply
  ON public.whatsapp_conversation_state (lead_id)
  WHERE last_direction = 'inbound' AND has_inbound;

CREATE OR REPLACE FUNCTION public.trg_whatsapp_messages_touch_conversation_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $tg$
DECLARE
  v_key text;
  v_provider text;
BEGIN
  v_key := public.whatsapp_conversation_key(
    NEW.provider, NEW.business_phone_number_id, NEW.business_phone_number);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.direction IS DISTINCT FROM 'inbound' AND NEW.direction IS DISTINCT FROM 'outbound' THEN
    RETURN NEW;
  END IF;
  v_provider := CASE WHEN NEW.provider IN ('meta', 'plivo') THEN NEW.provider ELSE 'meta' END;

  INSERT INTO public.whatsapp_conversation_state (
    phone,
    business_number,
    provider,
    lead_id,
    last_direction,
    last_message_at,
    has_inbound,
    last_business_phone_number_id,
    updated_at
  ) VALUES (
    NEW.phone,
    v_key,
    v_provider,
    NEW.lead_id,
    NEW.direction,
    NEW.created_at,
    (NEW.direction = 'inbound'),
    NEW.business_phone_number_id,
    now()
  )
  ON CONFLICT (phone, business_number) DO UPDATE SET
    has_inbound = public.whatsapp_conversation_state.has_inbound
      OR EXCLUDED.has_inbound,
    last_direction = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN EXCLUDED.last_direction
      ELSE public.whatsapp_conversation_state.last_direction
    END,
    last_message_at = GREATEST(
      public.whatsapp_conversation_state.last_message_at, EXCLUDED.last_message_at),
    lead_id = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN COALESCE(EXCLUDED.lead_id, public.whatsapp_conversation_state.lead_id)
      ELSE public.whatsapp_conversation_state.lead_id
    END,
    last_business_phone_number_id = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN EXCLUDED.last_business_phone_number_id
      ELSE public.whatsapp_conversation_state.last_business_phone_number_id
    END,
    provider = EXCLUDED.provider,
    updated_at = now();

  RETURN NEW;
END;
$tg$;

DROP TRIGGER IF EXISTS trg_whatsapp_messages_touch_conversation_state
  ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_touch_conversation_state
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_whatsapp_messages_touch_conversation_state();

-- One-time backfill of last direction from the latest message per conversation.
SET LOCAL statement_timeout = '10min';

INSERT INTO public.whatsapp_conversation_state (
  phone,
  business_number,
  provider,
  lead_id,
  last_direction,
  last_message_at,
  has_inbound,
  last_business_phone_number_id,
  updated_at
)
SELECT
  last.phone,
  last.ckey,
  CASE WHEN last.provider IN ('meta', 'plivo') THEN last.provider ELSE 'meta' END,
  last.lead_id,
  last.direction,
  last.created_at,
  last.direction = 'inbound',
  last.business_phone_number_id,
  now()
FROM (
  SELECT DISTINCT ON (
    wm.phone,
    public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number)
  )
    wm.phone,
    public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) AS ckey,
    wm.provider,
    wm.lead_id,
    wm.direction,
    wm.created_at,
    wm.business_phone_number_id
  FROM public.whatsapp_messages wm
  WHERE public.whatsapp_conversation_key(
          wm.provider, wm.business_phone_number_id, wm.business_phone_number) <> ''
  ORDER BY wm.phone,
    public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number),
    wm.created_at DESC
) last
ON CONFLICT (phone, business_number) DO UPDATE SET
  last_direction = EXCLUDED.last_direction,
  last_message_at = EXCLUDED.last_message_at,
  has_inbound = public.whatsapp_conversation_state.has_inbound OR EXCLUDED.has_inbound,
  last_business_phone_number_id = COALESCE(
    EXCLUDED.last_business_phone_number_id,
    public.whatsapp_conversation_state.last_business_phone_number_id),
  lead_id = COALESCE(public.whatsapp_conversation_state.lead_id, EXCLUDED.lead_id);

-- Outbound-last threads that still received an inbound earlier.
UPDATE public.whatsapp_conversation_state s
SET has_inbound = true
WHERE s.last_direction = 'outbound'
  AND NOT s.has_inbound
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_messages wm
    WHERE wm.phone = s.phone
      AND wm.direction = 'inbound'
      AND public.whatsapp_conversation_key(
            wm.provider, wm.business_phone_number_id, wm.business_phone_number) = s.business_number
  );

CREATE OR REPLACE FUNCTION public.whatsapp_reply_state_counts(
  p_counsellor_id uuid DEFAULT NULL::uuid,
  p_business_key text DEFAULT NULL::text,
  p_include_outbound_only boolean DEFAULT false
)
RETURNS TABLE(needs_reply integer, awaiting_them integer, unread_messages integer, total integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*) FILTER (
      WHERE s.last_direction = 'inbound'
        AND s.has_inbound
        AND COALESCE(l.stage::text, '') <> 'dnc'
    )::integer,
    COUNT(*) FILTER (
      WHERE s.last_direction = 'outbound'
        AND (p_include_outbound_only OR s.has_inbound)
    )::integer,
    0::integer,
    COUNT(*) FILTER (
      WHERE p_include_outbound_only OR s.has_inbound
    )::integer
  FROM public.whatsapp_conversation_state s
  LEFT JOIN public.leads l ON l.id = s.lead_id
  WHERE (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    AND (
      p_business_key IS NULL
      OR (p_business_key = 'unattributed' AND s.last_business_phone_number_id IS NULL)
      OR (p_business_key <> 'unattributed' AND (
            s.last_business_phone_number_id = p_business_key
         OR s.business_number = p_business_key))
    );
$function$;

COMMENT ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) IS
  'Pending WhatsApp reply status from whatsapp_conversation_state.last_direction. unread_messages is unused (always 0); chips count conversations waiting on a counsellor reply.';

GRANT EXECUTE ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) TO authenticated;

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

    -- Pending conversations (last inbound, not DNC), not unread-message scans.
    SELECT COUNT(*)::integer INTO v_wa_unread
    FROM public.whatsapp_conversation_state s
    JOIN public.leads l ON l.id = s.lead_id
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND s.last_direction = 'inbound'
      AND s.has_inbound
      AND COALESCE(l.stage::text, '') <> 'dnc';

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
    FROM public.whatsapp_conversation_state s
    LEFT JOIN public.leads l ON l.id = s.lead_id
    WHERE s.last_direction = 'inbound'
      AND s.has_inbound
      AND COALESCE(l.stage::text, '') <> 'dnc'
      AND (
        v_include_unassigned = true
        OR l.counsellor_id IS NOT NULL
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
