-- Auto-categorize leads based on WhatsApp message content
-- Called by webhook on new inbound messages + one-time backfill

CREATE OR REPLACE FUNCTION public.auto_categorize_lead_from_message(
  _lead_id uuid,
  _message_text text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_role text;
  v_msg text;
  v_category text := null;
BEGIN
  IF _lead_id IS NULL OR _message_text IS NULL OR _message_text = '' THEN
    RETURN null;
  END IF;

  -- Only auto-categorize leads with person_role = 'lead' (don't override manual)
  SELECT person_role INTO v_current_role FROM leads WHERE id = _lead_id;
  IF v_current_role IS DISTINCT FROM 'lead' THEN
    RETURN v_current_role; -- already categorized
  END IF;

  v_msg := lower(_message_text);

  -- Job applicant keywords
  IF v_msg ~ '\y(job|vacancy|hiring|salary|resume|cv|naukri|rozgar|placement\s+cell|kaam|openings?|recrui|walk.?in|joining|fresher|experience\s+\d|ctc|stipend|working\s+in|work\s+from|intern|inhand|in.hand)\y'
     AND v_msg !~ '\y(admission|course|fee|seat|hostel|scholarship|apply|enroll|campus\s+visit|counsellor)\y'
  THEN
    v_category := 'job_applicant';
  -- Vendor keywords
  ELSIF v_msg ~ '\y(quotation|quote|vendor|supplier|supply|catalogue|catalog|brochure|rate\s*card|price\s*list|bulk|wholesale|partnership|tie.?up|collaboration|invoice|payment\s+terms|gst\s+number|company\s+profile|proposal)\y'
  THEN
    v_category := 'vendor';
  END IF;

  IF v_category IS NOT NULL THEN
    UPDATE leads
    SET person_role = v_category,
        stage = 'not_interested'
    WHERE id = _lead_id AND person_role = 'lead';
    RETURN v_category;
  END IF;

  RETURN 'lead'; -- no match, stays as admission lead
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_categorize_lead_from_message TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_categorize_lead_from_message TO service_role;

-- Backfill: scan all existing inbound WhatsApp messages for leads with person_role='lead'
DO $$
DECLARE
  r RECORD;
  v_result text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (wm.lead_id)
      wm.lead_id,
      string_agg(wm.content, ' ' ORDER BY wm.created_at DESC) AS all_messages
    FROM whatsapp_messages wm
    INNER JOIN leads l ON l.id = wm.lead_id
    WHERE wm.direction = 'inbound'
      AND wm.content IS NOT NULL
      AND wm.content != ''
      AND l.person_role = 'lead'
    GROUP BY wm.lead_id
  LOOP
    v_result := public.auto_categorize_lead_from_message(r.lead_id, r.all_messages);
  END LOOP;
END $$;
