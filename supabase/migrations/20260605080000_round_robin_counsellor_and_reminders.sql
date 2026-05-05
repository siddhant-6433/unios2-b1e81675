-- Round-robin counsellor assignment + counsellor reminder cron.
--
-- Used by:
--   • voice-agent's request_human_callback tool — when an unassigned lead
--     asks for a human callback, the lead gets auto-assigned to the
--     least-loaded counsellor (within the lead's campus team if one exists,
--     otherwise any counsellor).
--   • Future inbound-lead intake paths can reuse fn_round_robin_assign_counsellor
--     for fresh-lead distribution.
--
-- The reminder cron runs every 15 minutes during business hours and posts
-- counsellor-bell notifications for:
--   • lead_followups due within the next 30 min that aren't completed
--   • campus_visits scheduled within the next 60 min in 'scheduled' status
-- Idempotency is keyed on (user_id, lead_id, type) so re-runs don't spam.

-- ─── Notification type CHECK extension ────────────────────────────────
-- Extend the allow-list before any inserts use the new values.
-- Existing types (must be preserved):
--   lead_assigned, sla_warning, lead_reclaimed, followup_due, followup_overdue,
--   visit_confirmation_due, visit_followup_due, lead_transferred,
--   deletion_request, general, whatsapp_message, approval_pending,
--   approval_decided, missed_call
-- New types added here:
--   visit_due           — campus visit starting in <60 min
--   callback_requested  — voice agent flagged a human callback

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned', 'sla_warning', 'lead_reclaimed',
  'followup_due', 'followup_overdue', 'visit_confirmation_due',
  'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
  'whatsapp_message', 'approval_pending', 'approval_decided',
  'missed_call',
  'visit_due', 'callback_requested'
));

-- ─── Round-robin assignment ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_round_robin_assign_counsellor(_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead          public.leads%ROWTYPE;
  v_counsellor_id uuid;
  v_team_id       uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Already assigned? Return existing.
  IF v_lead.counsellor_id IS NOT NULL THEN
    RETURN v_lead.counsellor_id;
  END IF;

  -- Try to find a team scoped to the lead's campus first; fall back to any team.
  SELECT t.id INTO v_team_id
  FROM public.teams t
  WHERE (t.campus_id = v_lead.campus_id OR v_lead.campus_id IS NULL)
  ORDER BY (t.campus_id = v_lead.campus_id) DESC NULLS LAST, t.created_at ASC
  LIMIT 1;

  -- Pick the least-loaded counsellor in that team (or any counsellor
  -- if no team membership exists). "Load" = currently-pending followups.
  WITH eligible AS (
    SELECT p.id AS profile_id, p.user_id
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'counsellor'
    LEFT JOIN public.team_members tm ON tm.user_id = p.user_id
    WHERE
      v_team_id IS NULL
      OR tm.team_id = v_team_id
  ),
  loads AS (
    SELECT e.profile_id, e.user_id,
           COALESCE((
             SELECT COUNT(*) FROM public.lead_followups f
             WHERE f.user_id = e.user_id AND f.status = 'pending'
           ), 0) AS load
    FROM eligible e
  )
  SELECT profile_id INTO v_counsellor_id
  FROM loads
  ORDER BY load ASC, random() ASC
  LIMIT 1;

  IF v_counsellor_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads SET counsellor_id = v_counsellor_id, updated_at = now()
  WHERE id = _lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (_lead_id, 'system',
          'Auto-assigned to counsellor via round-robin (load-balanced).');

  RETURN v_counsellor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_round_robin_assign_counsellor(uuid) TO authenticated, service_role;

-- ─── Reminder cron helper ──────────────────────────────────────────────
-- Posts notifications for upcoming followups + visits, keyed for idempotency.

CREATE OR REPLACE FUNCTION public.fn_post_counsellor_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_ist_hour int;
  v_ist_dow  int;
BEGIN
  -- Only during business hours (9 AM - 8 PM IST, Mon-Sat)
  v_ist_hour := EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Kolkata')::int;
  v_ist_dow  := EXTRACT(DOW  FROM now() AT TIME ZONE 'Asia/Kolkata')::int;
  IF v_ist_hour < 9 OR v_ist_hour >= 20 OR v_ist_dow = 0 THEN RETURN; END IF;

  -- 1. Followups due in next 30 minutes
  FOR r IN
    SELECT f.id, f.lead_id, f.user_id, f.scheduled_at, l.name AS lead_name, l.phone
    FROM public.lead_followups f
    JOIN public.leads l ON l.id = f.lead_id
    WHERE f.status = 'pending'
      AND f.user_id IS NOT NULL
      AND f.scheduled_at >  now()
      AND f.scheduled_at <= now() + interval '30 minutes'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = r.user_id
        AND lead_id = r.lead_id
        AND type    = 'followup_due'
        AND created_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
      VALUES (
        r.user_id, 'followup_due',
        'Follow-up due in <30 min',
        format('%s (%s) — call back at %s IST', r.lead_name, COALESCE(r.phone, '—'),
               to_char(r.scheduled_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')),
        '/admissions/' || r.lead_id::text,
        r.lead_id
      );
    END IF;
  END LOOP;

  -- 2. Visits scheduled in next 60 minutes
  FOR r IN
    SELECT v.id, v.lead_id, l.counsellor_id AS profile_id, p.user_id, v.visit_date,
           l.name AS lead_name, l.phone
    FROM public.campus_visits v
    JOIN public.leads l ON l.id = v.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE v.status = 'scheduled'
      AND v.visit_date >  now()
      AND v.visit_date <= now() + interval '60 minutes'
      AND p.user_id IS NOT NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = r.user_id
        AND lead_id = r.lead_id
        AND type    = 'visit_due'
        AND created_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
      VALUES (
        r.user_id, 'visit_due',
        'Campus visit in <60 min',
        format('%s (%s) — arrives at %s IST', r.lead_name, COALESCE(r.phone, '—'),
               to_char(r.visit_date AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')),
        '/admissions/' || r.lead_id::text,
        r.lead_id
      );
    END IF;
  END LOOP;
END;
$$;

-- Schedule every 15 minutes
SELECT cron.schedule(
  'counsellor-reminders',
  '*/15 * * * *',
  $$SELECT public.fn_post_counsellor_reminders()$$
);
