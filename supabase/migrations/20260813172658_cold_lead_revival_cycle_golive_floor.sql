-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260813172658 name=cold_lead_revival_cycle_golive_floor applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Go-live floor for the cold revival cycle. 3,188 leads were already cold when
-- this shipped (3,134 of them for 30+ days, almost all from the AI auto-cold
-- handler). Without the floor the first cron run would open a revival task for
-- every one of them and auto-close the lot 30 days later.
CREATE OR REPLACE FUNCTION public.fn_cold_lead_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

  -- (b) Close: both rounds spent, no response.
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

  -- (c) Open the next round. Disjoint from (b) by rounds_spent.
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
