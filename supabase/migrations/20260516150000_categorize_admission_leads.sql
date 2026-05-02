-- Update auto_categorize to also positively identify admission inquiries
-- and mark leads that match admission keywords with person_role='applicant'
-- so they show distinctly from uncategorized leads

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
    RETURN v_current_role;
  END IF;

  v_msg := lower(_message_text);

  -- Job applicant keywords (exclude if admission keywords also present)
  IF v_msg ~ '\y(job|vacancy|hiring|salary|resume|cv|naukri|rozgar|placement\s+cell|kaam|openings?|recrui|walk.?in|joining|fresher|experience\s+\d|ctc|stipend|working\s+in|work\s+from|intern|inhand|in.hand)\y'
     AND v_msg !~ '\y(admission|course|fee|seat|hostel|scholarship|apply|enroll|campus\s+visit|counsellor|nursing|bpt|mba|bba|bca|pharma|law|llb|btech|b\.sc|m\.sc|bed|b\.ed)\y'
  THEN
    v_category := 'job_applicant';
  -- Vendor keywords
  ELSIF v_msg ~ '\y(quotation|quote|vendor|supplier|supply|catalogue|catalog|brochure|rate\s*card|price\s*list|bulk|wholesale|partnership|tie.?up|collaboration|invoice|payment\s+terms|gst\s+number|company\s+profile|proposal)\y'
  THEN
    v_category := 'vendor';
  -- Admission inquiry keywords — positive match
  ELSIF v_msg ~ '\y(admission|course|fee|seat|hostel|scholarship|apply|enroll|campus|visit|counsellor|nursing|bpt|mba|bba|bca|pharma|law|llb|btech|b\.sc|m\.sc|bed|b\.ed|college|university|degree|diploma|eligibility|cutoff|cut.off|merit|entrance|exam|class\s*12|12th|10th|aadhaar|form|prospectus|brochure|placement|package|lateral|session|2026|2027)\y'
  THEN
    v_category := 'lead'; -- confirmed admission, keep as lead (stage unchanged)
  END IF;

  IF v_category IS NOT NULL AND v_category != 'lead' THEN
    UPDATE leads
    SET person_role = v_category,
        stage = 'not_interested'
    WHERE id = _lead_id AND person_role = 'lead';
  END IF;

  RETURN COALESCE(v_category, 'lead');
END;
$$;

-- Re-run backfill with updated function
DO $$
DECLARE
  r RECORD;
  v_result text;
  v_job int := 0;
  v_vendor int := 0;
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
    IF v_result = 'job_applicant' THEN v_job := v_job + 1;
    ELSIF v_result = 'vendor' THEN v_vendor := v_vendor + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Auto-categorized: % job applicants, % vendors', v_job, v_vendor;
END $$;
