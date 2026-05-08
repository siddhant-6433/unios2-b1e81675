-- Assign any remaining leads that have overdue followups but no counsellor.
-- Catches the ~20 leads that didn't match the AI-max-retry note pattern.
DO $$
DECLARE
  r       RECORD;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT l.id, l.stage::text AS stage
    FROM public.leads l
    WHERE l.counsellor_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.lead_followups f
        WHERE f.lead_id = l.id
          AND f.status = 'pending'
          AND f.scheduled_at < now()
      )
  LOOP
    IF public.fn_round_robin_assign_counsellor(r.id) IS NOT NULL THEN
      IF r.stage = 'new_lead' THEN
        UPDATE public.leads SET stage = 'counsellor_call', updated_at = now() WHERE id = r.id;
      END IF;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Assigned counsellors to % remaining unassigned leads', v_count;
END;
$$;
