-- Find leads in active stages (new_lead, counsellor_call) that have manual calls
-- but NO pending followups, and create followups for them.
-- These leads fell through the cracks because the follow-up dialog was dismissable.

DO $$
DECLARE
  r RECORD;
  v_count int := 0;
  v_followup_at timestamptz;
BEGIN
  FOR r IN
    SELECT DISTINCT l.id AS lead_id, l.name, l.stage,
      (SELECT MAX(cl.called_at) FROM call_logs cl WHERE cl.lead_id = l.id) AS last_call_at
    FROM leads l
    WHERE l.stage IN ('new_lead', 'counsellor_call')
      AND l.is_mirror = false
      -- Has at least one manual call logged
      AND EXISTS (SELECT 1 FROM call_logs cl WHERE cl.lead_id = l.id)
      -- But NO pending followup
      AND NOT EXISTS (SELECT 1 FROM lead_followups lf WHERE lf.lead_id = l.id AND lf.status = 'pending')
  LOOP
    -- Schedule followup: if last call was today, followup tomorrow 10am
    -- Otherwise, followup today at 10am (they're already overdue)
    IF r.last_call_at > now() - interval '1 day' THEN
      v_followup_at := date_trunc('day', now() + interval '1 day') + interval '4 hours 30 minutes'; -- 10am IST
    ELSE
      v_followup_at := date_trunc('day', now()) + interval '4 hours 30 minutes'; -- 10am IST today
    END IF;

    INSERT INTO lead_followups (lead_id, scheduled_at, type, notes, status)
    VALUES (r.lead_id, v_followup_at, 'call',
      'Auto-created: lead had calls logged but no follow-up scheduled',
      'pending');

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Created followups for % leads', v_count;
END $$;
