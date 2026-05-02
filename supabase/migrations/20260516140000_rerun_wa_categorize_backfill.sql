-- Re-run auto-categorization backfill with more aggressive matching
-- Scans ALL inbound WhatsApp messages for leads still marked as person_role='lead'

DO $$
DECLARE
  r RECORD;
  v_msg text;
  v_result text;
BEGIN
  FOR r IN
    SELECT
      l.id AS lead_id,
      string_agg(wm.content, ' ' ORDER BY wm.created_at DESC) AS all_messages
    FROM leads l
    INNER JOIN whatsapp_messages wm ON wm.lead_id = l.id
    WHERE wm.direction = 'inbound'
      AND wm.content IS NOT NULL
      AND wm.content != ''
      AND l.person_role = 'lead'
    GROUP BY l.id
  LOOP
    v_result := public.auto_categorize_lead_from_message(r.lead_id, r.all_messages);
    IF v_result IS NOT NULL AND v_result != 'lead' THEN
      RAISE NOTICE 'Categorized lead % as %', r.lead_id, v_result;
    END IF;
  END LOOP;
END $$;
