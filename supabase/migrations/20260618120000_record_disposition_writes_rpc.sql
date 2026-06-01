-- Performance: collapse the call-disposition save into ONE round-trip.
--
-- Saving a disposition from the lead page used to fire ~8 separate Supabase
-- writes, each its own network round-trip and each re-evaluating the per-row
-- can_view_lead() RLS on leads / lead_activities / lead_followups. From India
-- that stacked into multi-second saves that counsellors complained about.
--
-- This SECURITY DEFINER function does every write in a single transaction, so
-- the client makes one call and the RLS authorization check is paid ONCE (the
-- explicit can_view_lead guard below) instead of per row, per table.
--
-- DESIGN: the client still owns all business logic (which stage to advance to,
-- the exact activity wording, whether a follow-up is scheduled). It resolves
-- those and passes them in. Nothing from src/lib/leadStages.ts is ported into
-- SQL — this function only executes the already-decided writes. NULL params
-- mean "skip that write" (no stage change / no scheduled follow-up).
--
-- SECURITY: SECURITY DEFINER bypasses RLS on the writes below, so the
-- can_view_lead() guard is what preserves access control. It mirrors the
-- "Staff can view leads" SELECT policy (same function the policy uses), so a
-- caller can only drive writes for a lead they were already allowed to see and
-- mutate via the previous per-statement RLS path. A caller who passes a
-- p_lead_id they cannot view gets 42501, exactly as the old path would have.

CREATE OR REPLACE FUNCTION public.record_disposition_writes(
  p_call_uuid               text,
  p_lead_id                 uuid,
  p_user_id                 uuid,         -- auth user id (call_logs / followups author)
  p_profile_id              uuid,         -- profiles.id (lead_activities author)
  p_disposition             text,
  p_duration                integer,
  p_call_notes              text,
  p_call_source             text,         -- cloud_dialer | manual_log | inbound | NULL
  p_call_activity_desc      text,
  p_old_stage               text,         -- current stage, for the stage_change row
  p_new_stage               text,         -- NULL => no stage change
  p_stage_activity_desc     text,         -- NULL => no stage_change activity
  p_future_eligible_session text,         -- NULL unless deferred-to-future-session
  p_followup_at             timestamptz,  -- NULL => no scheduled follow-up
  p_followup_notes          text,
  p_followup_activity_desc  text
) RETURNS uuid                            -- returns the call_logs row id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call_log_id uuid;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id is required';
  END IF;

  -- Single authorization gate (see SECURITY note above).
  IF v_uid IS NULL OR NOT can_view_lead(v_uid, p_lead_id) THEN
    RAISE EXCEPTION 'not authorized for lead %', p_lead_id USING ERRCODE = '42501';
  END IF;

  -- 1. call_logs — reuse the existing dedup/merge function so Cloud Call rows
  --    keep merging onto the bridge-hangup webhook row (recording_url etc.).
  v_call_log_id := record_cloud_call_log(
    p_call_uuid, p_lead_id, p_user_id, p_disposition, p_duration,
    p_call_notes, 'manual', NULL, p_call_source
  );

  -- 2. Close any pending follow-ups — the call just happened. Done before the
  --    scheduled-follow-up insert below so it can't sweep away the new row.
  UPDATE public.lead_followups
     SET status = 'completed', completed_at = now()
   WHERE lead_id = p_lead_id
     AND status  = 'pending';

  -- 3. Call activity row.
  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (p_lead_id, p_profile_id, 'call', p_call_activity_desc);

  -- 4. Stage advance — only when the client resolved a target stage.
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

  -- 5. Inline-scheduled follow-up — only when the client scheduled one.
  IF p_followup_at IS NOT NULL THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
    VALUES (p_lead_id, p_user_id, p_followup_at, 'call', p_followup_notes, 'pending');

    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (p_lead_id, p_profile_id, 'followup', p_followup_activity_desc);
  END IF;

  RETURN v_call_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, timestamptz, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, timestamptz, text, text
) TO service_role;
