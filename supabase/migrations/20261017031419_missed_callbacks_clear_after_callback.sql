-- "Missed Callbacks" chip counted every missed inbound call ever logged, so it
-- only grew. A missed callback is now cleared by any later call activity on
-- the lead (outbound attempt or an answered inbound) — i.e. once someone has
-- called back. Uses idx_call_logs_lead_called_at_exists (lead_id, called_at).
--
-- Patches only the two missed-callback queries inside the LIVE function body
-- (the migration files have drifted from prod), so nothing else is clobbered.
-- Idempotent: a second run finds the marker and exits.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.action_badge_counts(uuid,boolean)'::regprocedure);
  v_old text := $q$AND cl.disposition = 'missed';$q$;
  v_new text := $q$AND cl.disposition = 'missed'
      -- missed_callback_cleared_by_later_call
      AND NOT EXISTS (
        SELECT 1 FROM public.call_logs later
        WHERE later.lead_id = cl.lead_id
          AND later.called_at > cl.called_at
          AND NOT (later.direction = 'inbound' AND later.disposition = 'missed')
      );$q$;
  v_hits int;
BEGIN
  IF position('missed_callback_cleared_by_later_call' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 2 THEN
    RAISE EXCEPTION 'action_badge_counts: expected 2 missed-callback queries, found %', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
