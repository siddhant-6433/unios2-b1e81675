-- Cold lead revival cycle.
--
-- Counsellors can now pick "Cold" in the call disposition dialog after repeated
-- unanswered calls. A cold lead gets a revival follow-up 15 days later; after
-- TWO revival rounds with no response the lead auto-closes as not_interested.
--
-- "cold" is a terminal stage in ~8 places (cloud_dialer_queue, overdue_followups,
-- counsellor_dial_guard, pending_followups_payload, the AI call queue, and the
-- trg_cancel_followups_terminal_stage trigger which cancels every pending
-- follow-up on entry to a terminal stage). Rather than un-terminal cold
-- everywhere, the revival cycle gets its own lane: rows tagged
-- lead_followups.type = 'cold_followup', exempted from the cancel trigger and
-- surfaced through a dedicated "cold" tab. Cold stays terminal for the dialer,
-- the SLA guard and every existing count.

-- ── 1. Exempt cold-cycle rows from the terminal-stage cancel trigger ─────────
-- Body is 20260618151000_fix_cloud_dialer_terminal_followups.sql plus the
-- type guard. The trigger itself is unchanged.
CREATE OR REPLACE FUNCTION public.fn_cancel_followups_on_terminal_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    UPDATE public.lead_followups
    SET status = 'cancelled',
        completed_at = now()
    WHERE lead_id = NEW.id
      AND status = 'pending'
      AND type <> 'cold_followup';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Start the cycle whenever a lead enters cold ──────────────────────────
-- Fires on the leads table (not inside the disposition RPC) so every path into
-- cold is covered at once: the new disposition, the manual stage dropdown in
-- LeadInfoCard, the classifyInactive command, and the ai-call-failed-handler
-- edge function.
CREATE OR REPLACE FUNCTION public.fn_start_cold_followup_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Idempotent: a lead bouncing back into cold keeps its open revival round.
  IF EXISTS (
    SELECT 1 FROM public.lead_followups
     WHERE lead_id = NEW.id AND type = 'cold_followup' AND status = 'pending'
  ) THEN
    RETURN NEW;
  END IF;

  -- lead_followups.user_id references auth.users; leads.counsellor_id is a
  -- profiles.id, hence the join. ai-call-failed-handler sets stage='cold' and
  -- counsellor_id=NULL in the same UPDATE, so fall back to OLD.
  SELECT p.user_id INTO v_user_id
    FROM public.profiles p
   WHERE p.id = COALESCE(NEW.counsellor_id, OLD.counsellor_id);

  INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
  VALUES (
    NEW.id, v_user_id, now() + interval '15 days', 'cold_followup',
    'Cold revival follow-up 1 of 2', 'pending'
  );

  RETURN NEW;
END;
$$;

-- Trigger name sorts before trg_cancel_followups_terminal_stage would matter:
-- 'c' < 's', so the cancel trigger runs first and this insert survives it.
DROP TRIGGER IF EXISTS trg_start_cold_followup_cycle ON public.leads;
CREATE TRIGGER trg_start_cold_followup_cycle
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (NEW.stage = 'cold' AND OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.fn_start_cold_followup_cycle();

-- ── 3. Don't let a "not_answered" disposition drag the revival row forward ───
-- The not_answered branch reschedules every pending row to the counsellor's
-- 2-hour callback slot. A revival round is not a callback: mark it spent and
-- let fn_cold_lead_cycle() decide whether round 2 or the close comes next.
--
-- This also repairs a live overload split. Two overloads of
-- record_disposition_writes exist: the 19-arg one (20260701110000, the one the
-- frontend actually calls — it always sends p_requested_course_text) and the
-- 18-arg one. 20260702120000 restored the "not_answered keeps the follow-up
-- open" guard on the 18-arg overload ONLY, so in production the guard has been
-- dead: every counsellor call, answered or not, completed the pending
-- follow-up. Below, the 19-arg overload carries the real body and the 18-arg
-- one becomes a thin forwarder, so the two can never drift again.
CREATE OR REPLACE FUNCTION public.record_disposition_writes(
  p_call_uuid               text,
  p_lead_id                 uuid,
  p_user_id                 uuid,
  p_profile_id              uuid,
  p_disposition             text,
  p_duration                integer,
  p_call_notes              text,
  p_call_source             text,
  p_call_activity_desc      text,
  p_old_stage               text,
  p_new_stage               text,
  p_stage_activity_desc     text,
  p_future_eligible_session text,
  p_cnet_appeared           boolean,
  p_cahet_registered        boolean,
  p_followup_at             timestamptz,
  p_followup_notes          text,
  p_followup_activity_desc  text,
  p_requested_course_text   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call_log_id uuid;
  v_uid uuid := (SELECT auth.uid());
  v_should_clear_followups boolean := true;
  v_rescheduled_count integer := 0;
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id is required';
  END IF;

  IF v_uid IS NULL OR NOT can_view_lead(v_uid, p_lead_id) THEN
    RAISE EXCEPTION 'not authorized for lead %', p_lead_id USING ERRCODE = '42501';
  END IF;

  v_call_log_id := record_cloud_call_log(
    p_call_uuid, p_lead_id, p_user_id, p_disposition, p_duration,
    p_call_notes, 'manual', NULL, p_call_source
  );

  IF p_requested_course_text IS NOT NULL THEN
    UPDATE public.call_logs
       SET requested_course_text = p_requested_course_text
     WHERE id = v_call_log_id;
  END IF;

  v_should_clear_followups := p_disposition <> 'not_answered';

  IF v_should_clear_followups THEN
    UPDATE public.lead_followups
       SET status = 'completed', completed_at = now()
     WHERE lead_id = p_lead_id
       AND status  = 'pending';
  ELSE
    -- A revival round the counsellor just worked is spent either way.
    UPDATE public.lead_followups
       SET status = 'completed', completed_at = now()
     WHERE lead_id = p_lead_id
       AND status  = 'pending'
       AND type    = 'cold_followup';

    IF p_followup_at IS NOT NULL THEN
      UPDATE public.lead_followups
         SET scheduled_at = p_followup_at,
             notes = COALESCE(p_followup_notes, notes)
       WHERE lead_id = p_lead_id
         AND status  = 'pending'
         AND type    <> 'cold_followup';
      GET DIAGNOSTICS v_rescheduled_count = ROW_COUNT;
    END IF;
  END IF;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (p_lead_id, p_profile_id, 'call', p_call_activity_desc);

  IF p_cnet_appeared IS NOT NULL THEN
    UPDATE public.leads
       SET cnet_appeared = p_cnet_appeared,
           updated_at = now()
     WHERE id = p_lead_id;
  END IF;

  IF p_cahet_registered IS NOT NULL THEN
    UPDATE public.leads
       SET cahet_registered = p_cahet_registered,
           updated_at = now()
     WHERE id = p_lead_id;
  END IF;

  IF p_new_stage IS NOT NULL THEN
    UPDATE public.leads
       SET stage = p_new_stage::lead_stage,
           future_eligible_session = COALESCE(p_future_eligible_session, future_eligible_session)
     WHERE id = p_lead_id;

    INSERT INTO public.lead_activities (lead_id, user_id, type, description, old_stage, new_stage)
    VALUES (
      p_lead_id, p_profile_id, 'stage_change', p_stage_activity_desc,
      p_old_stage::lead_stage, p_new_stage::lead_stage
    );
  END IF;

  IF p_followup_at IS NOT NULL AND v_should_clear_followups THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
    VALUES (p_lead_id, p_user_id, p_followup_at, 'call', p_followup_notes, 'pending');

    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (p_lead_id, p_profile_id, 'followup', p_followup_activity_desc);
  ELSIF p_followup_at IS NOT NULL AND p_disposition = 'not_answered' THEN
    IF v_rescheduled_count = 0 THEN
      INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
      VALUES (p_lead_id, p_user_id, p_followup_at, 'call', p_followup_notes, 'pending');
    END IF;

    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (p_lead_id, p_profile_id, 'followup', COALESCE(p_followup_activity_desc, 'Follow-up rescheduled after not answered'));
  END IF;

  RETURN v_call_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text, text
) TO service_role;

-- The 18-arg overload the client falls back to when PostgREST's schema cache is
-- behind. Forwards to the body above so the follow-up guard can't drift again.
CREATE OR REPLACE FUNCTION public.record_disposition_writes(
  p_call_uuid               text,
  p_lead_id                 uuid,
  p_user_id                 uuid,
  p_profile_id              uuid,
  p_disposition             text,
  p_duration                integer,
  p_call_notes              text,
  p_call_source             text,
  p_call_activity_desc      text,
  p_old_stage               text,
  p_new_stage               text,
  p_stage_activity_desc     text,
  p_future_eligible_session text,
  p_cnet_appeared           boolean,
  p_cahet_registered        boolean,
  p_followup_at             timestamptz,
  p_followup_notes          text,
  p_followup_activity_desc  text
) RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.record_disposition_writes(
    p_call_uuid, p_lead_id, p_user_id, p_profile_id, p_disposition, p_duration,
    p_call_notes, p_call_source, p_call_activity_desc, p_old_stage, p_new_stage,
    p_stage_activity_desc, p_future_eligible_session, p_cnet_appeared,
    p_cahet_registered, p_followup_at, p_followup_notes, p_followup_activity_desc,
    NULL::text
  );
$$;

GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO service_role;

-- ── 4. Cycle state + the daily cron that advances it ─────────────────────────
-- One view so the state machine is readable (and debuggable with a plain
-- SELECT) instead of buried in plpgsql. Not granted to authenticated — only
-- the SECURITY DEFINER function below reads it.
CREATE OR REPLACE VIEW public.cold_cycle_state AS
SELECT
  l.id AS lead_id,
  l.counsellor_id,
  s.cold_at,
  (SELECT count(*) FROM public.lead_followups lf
    WHERE lf.lead_id = l.id
      AND lf.type = 'cold_followup'
      AND lf.created_at >= s.cold_at)::integer AS rounds_spent,
  EXISTS (
    SELECT 1 FROM public.lead_followups lf
     WHERE lf.lead_id = l.id AND lf.type = 'cold_followup' AND lf.status = 'pending'
  ) AS has_open_round,
  (
    EXISTS (SELECT 1 FROM public.call_logs cl
             WHERE cl.lead_id = l.id AND cl.called_at > s.cold_at AND cl.duration_seconds > 0)
    OR EXISTS (SELECT 1 FROM public.ai_call_records acr
                WHERE acr.lead_id = l.id AND acr.status = 'completed' AND acr.created_at > s.cold_at)
    OR EXISTS (SELECT 1 FROM public.whatsapp_messages wm
                WHERE wm.lead_id = l.id AND wm.direction = 'inbound' AND wm.created_at > s.cold_at)
  ) AS responded
FROM public.leads l
CROSS JOIN LATERAL (
  SELECT COALESCE(
    (SELECT max(la.created_at) FROM public.lead_activities la
      WHERE la.lead_id = l.id AND la.type = 'stage_change' AND la.new_stage = 'cold'),
    (SELECT min(lf.created_at) FROM public.lead_followups lf
      WHERE lf.lead_id = l.id AND lf.type = 'cold_followup'),
    l.updated_at
  ) AS cold_at
) s
WHERE l.stage = 'cold';

CREATE OR REPLACE FUNCTION public.fn_cold_lead_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Go-live floor. 3,188 leads were already cold when this shipped (3,134 of
  -- them for 30+ days, almost all from the AI auto-cold handler). Without the
  -- floor the first cron run would dump a revival task on a counsellor for
  -- every one of them, then auto-close the lot 30 days later. The cycle only
  -- applies to leads that go cold from here on. Same pattern as the beacon
  -- late-fee engine's no-backdating floor.
  -- ponytail: hardcoded date; move to a settings row if the backlog is ever
  -- deliberately swept in.
  v_floor constant timestamptz := '2026-08-13 00:00:00+00';
  v_stale   integer := 0;
  v_closed  integer := 0;
  v_opened  integer := 0;
BEGIN
  -- (a) A round the counsellor never worked still counts as spent, otherwise a
  -- busy team stalls the cycle forever and nothing ever closes.
  UPDATE public.lead_followups lf
     SET status = 'cancelled', completed_at = now()
    FROM public.leads l
   WHERE lf.lead_id = l.id
     AND l.stage = 'cold'
     AND lf.type = 'cold_followup'
     AND lf.status = 'pending'
     AND lf.scheduled_at < now() - interval '15 days';
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  -- (b) Close: both rounds spent, no response. The activity row is written
  -- first so the stage UPDATE's triggers see a consistent history.
  INSERT INTO public.lead_activities (lead_id, user_id, type, description, old_stage, new_stage)
  SELECT c.lead_id, c.counsellor_id, 'stage_change',
         'Auto-closed: no response after 2 cold follow-ups',
         'cold'::lead_stage, 'not_interested'::lead_stage
    FROM public.cold_cycle_state c
   WHERE NOT c.has_open_round
     AND NOT c.responded
     AND c.cold_at >= v_floor
     AND c.rounds_spent >= 2;

  UPDATE public.leads
     SET stage = 'not_interested', updated_at = now()
   WHERE id IN (
     SELECT c.lead_id FROM public.cold_cycle_state c
      WHERE NOT c.has_open_round AND NOT c.responded AND c.cold_at >= v_floor AND c.rounds_spent >= 2
   );
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- (c) Open the next round. Disjoint from (b) by rounds_spent, so ordering
  -- between the two statements does not matter.
  INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
  SELECT c.lead_id,
         (SELECT p.user_id FROM public.profiles p WHERE p.id = c.counsellor_id),
         now() + interval '15 days',
         'cold_followup',
         'Cold revival follow-up ' || (c.rounds_spent + 1)::text || ' of 2',
         'pending'
    FROM public.cold_cycle_state c
   WHERE NOT c.has_open_round
     AND NOT c.responded
     AND c.cold_at >= v_floor
     AND c.rounds_spent < 2;
  GET DIAGNOSTICS v_opened = ROW_COUNT;

  RETURN jsonb_build_object('stale', v_stale, 'closed', v_closed, 'opened', v_opened);
END;
$$;

SELECT cron.unschedule('cold-lead-cycle')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cold-lead-cycle');

-- 03:00 UTC = 08:30 IST, before the counsellor day starts.
SELECT cron.schedule('cold-lead-cycle', '0 3 * * *', $$SELECT public.fn_cold_lead_cycle()$$);

-- ── 5. Surface the open revival rounds in Pending Follow-ups ────────────────
-- Body is 20260618181000_pending_followups_payload.sql plus the cold tab. Its
-- scoped_leads CTE excludes cold by design, so the cold lane gets a sibling CTE.
CREATE OR REPLACE FUNCTION public.pending_followups_payload(
  p_tab text,
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_scope_unassigned boolean DEFAULT false,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  auth_scope AS (
    SELECT
      public.get_user_role(auth.uid())::text AS role_name,
      (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1) AS own_profile_id
  ),
  scope AS (
    SELECT
      CASE WHEN role_name = 'counsellor' THEN own_profile_id ELSE p_scope_counsellor_id END AS counsellor_id,
      CASE WHEN role_name = 'counsellor' THEN false ELSE COALESCE(p_scope_unassigned, false) END AS unassigned_only,
      GREATEST(COALESCE(p_page, 0), 0) AS page_no,
      LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100) AS page_size
    FROM auth_scope
  ),
  bounds AS (
    SELECT
      date_trunc('day', now()) AS today_start,
      date_trunc('day', now()) + interval '1 day' AS tomorrow_start,
      date_trunc('day', now()) + interval '7 days' AS week_end
  ),
  scoped_leads AS (
    SELECT l.*
    FROM public.leads l
    CROSS JOIN scope s
    WHERE l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'cold')
      AND (
        s.counsellor_id IS NULL
        OR l.counsellor_id = s.counsellor_id
      )
      AND (
        s.unassigned_only = false
        OR l.counsellor_id IS NULL
      )
  ),
  cold_scoped_leads AS (
    SELECT l.*
    FROM public.leads l
    CROSS JOIN scope s
    WHERE l.stage = 'cold'
      AND (
        s.counsellor_id IS NULL
        OR l.counsellor_id = s.counsellor_id
      )
      AND (
        s.unassigned_only = false
        OR l.counsellor_id IS NULL
      )
  ),
  cold_followups AS (
    SELECT lf.*
    FROM public.lead_followups lf
    JOIN cold_scoped_leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.type = 'cold_followup'
      AND lf.scheduled_at < (SELECT tomorrow_start FROM bounds)
  ),
  pending_followups AS (
    SELECT lf.*
    FROM public.lead_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
  ),
  followup_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE lf.scheduled_at < b.today_start)::integer AS overdue,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= b.today_start AND lf.scheduled_at < b.tomorrow_start)::integer AS today,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= b.tomorrow_start AND lf.scheduled_at <= b.week_end)::integer AS upcoming
    FROM pending_followups lf
    CROSS JOIN bounds b
  ),
  visit_confirm_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
  ),
  unclosed_visit_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7
  ),
  post_visit_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
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
      )
  ),
  counts AS (
    SELECT jsonb_build_object(
      'overdue', COALESCE(fc.overdue, 0),
      'today', COALESCE(fc.today, 0),
      'upcoming', COALESCE(fc.upcoming, 0),
      'visit_confirm', (SELECT COUNT(*)::integer FROM visit_confirm_rows),
      'unclosed_visits', (SELECT COUNT(*)::integer FROM unclosed_visit_rows),
      'post_visit', (SELECT COUNT(*)::integer FROM post_visit_rows),
      'cold', (SELECT COUNT(*)::integer FROM cold_followups)
    ) AS payload
    FROM followup_counts fc
  ),

  followup_items AS (
    SELECT
      lf.scheduled_at AS sort_at,
      jsonb_build_object(
        'id', lf.id,
        'lead_id', lf.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', COALESCE(l.stage::text, ''),
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'counsellor_id', l.counsellor_id,
        'type', COALESCE(lf.type::text, 'call'),
        'scheduled_at', lf.scheduled_at,
        'notes', lf.notes,
        'days_overdue', GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - lf.scheduled_at)) / 86400)::integer),
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM pending_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    CROSS JOIN bounds b
    WHERE (
      (p_tab = 'overdue' AND lf.scheduled_at < b.today_start)
      OR (p_tab = 'today' AND lf.scheduled_at >= b.today_start AND lf.scheduled_at < b.tomorrow_start)
      OR (p_tab = 'upcoming' AND lf.scheduled_at >= b.tomorrow_start AND lf.scheduled_at <= b.week_end)
    )
  ),
  cold_items AS (
    SELECT
      lf.scheduled_at AS sort_at,
      jsonb_build_object(
        'id', lf.id,
        'lead_id', lf.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', COALESCE(l.stage::text, ''),
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'counsellor_id', l.counsellor_id,
        'type', 'cold_followup',
        'scheduled_at', lf.scheduled_at,
        'notes', lf.notes,
        'days_overdue', GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - lf.scheduled_at)) / 86400)::integer),
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM cold_followups lf
    JOIN cold_scoped_leads l ON l.id = lf.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    WHERE p_tab = 'cold'
  ),
  visit_confirm_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', '',
        'counsellor_name', '',
        'counsellor_id', l.counsellor_id,
        'type', 'visit_confirmation',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'urgency', CASE
          WHEN cv.visit_date::date = CURRENT_DATE THEN 'same_day'
          WHEN cv.visit_date::date = CURRENT_DATE + 1 THEN 'day_before'
          ELSE 'future'
        END,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    WHERE p_tab = 'visit_confirm'
      AND cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
  ),
  unclosed_visit_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', '',
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'counsellor_id', l.counsellor_id,
        'type', 'unclosed_visit',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'days_overdue', floor(EXTRACT(EPOCH FROM (now() - cv.visit_date)) / 86400)::integer,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE p_tab = 'unclosed_visits'
      AND cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7
  ),
  post_visit_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', COALESCE(l.stage::text, ''),
        'counsellor_name', '',
        'counsellor_id', l.counsellor_id,
        'type', 'post_visit',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'days_since_visit', EXTRACT(DAY FROM now() - cv.visit_date)::integer,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    WHERE p_tab = 'post_visit'
      AND cv.status = 'completed'
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
      )
  ),
  all_items AS (
    SELECT * FROM followup_items
    UNION ALL SELECT * FROM cold_items
    UNION ALL SELECT * FROM visit_confirm_items
    UNION ALL SELECT * FROM unclosed_visit_items
    UNION ALL SELECT * FROM post_visit_items
  ),
  paged_items AS (
    SELECT payload, sort_at
    FROM all_items, scope s
    ORDER BY
      CASE WHEN p_tab IN ('today', 'upcoming') THEN sort_at END DESC NULLS LAST,
      sort_at ASC
    LIMIT (SELECT page_size FROM scope)
    OFFSET (SELECT page_no * page_size FROM scope)
  )
SELECT jsonb_build_object(
  'counts', (SELECT payload FROM counts),
  'items', COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at ASC) FROM paged_items), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.pending_followups_payload(text, uuid, boolean, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
