-- Improve auto-categorization regex with broader patterns
-- \y word boundary may not work in all cases, use \m and \M instead

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
  v_is_job boolean;
  v_is_vendor boolean;
  v_is_admission boolean;
BEGIN
  IF _lead_id IS NULL OR _message_text IS NULL OR _message_text = '' THEN
    RETURN null;
  END IF;

  SELECT person_role INTO v_current_role FROM leads WHERE id = _lead_id;
  IF v_current_role IS DISTINCT FROM 'lead' THEN
    RETURN v_current_role;
  END IF;

  v_msg := lower(_message_text);

  -- Check for job-related content
  v_is_job := v_msg ~* '(job|vacancy|hiring|salary|resume|cv|naukri|rozgar|kaam\s+chahiye|kaam\s+mil|openings?|recruit|walk[\s-]?in|joining|fresher|experience|ctc|stipend|working|work\s+from|intern|in[\s-]?hand|position|employ|staff\s+required|teacher\s+wanted|faculty\s+required|peon|driver|guard|helper|clerk|office\s+boy|data\s+entry\s+operator|accountant\s+job|receptionist)';

  -- Check for admission-related content
  v_is_admission := v_msg ~* '(admission|course|fee|fees|seat|hostel|scholarship|apply|enroll|campus|visit|counsellor|nursing|bpt|mba|bba|bca|pharma|law|llb|btech|b\.?sc|m\.?sc|bed|b\.?ed|college|university|degree|diploma|eligibility|cutoff|cut[\s-]?off|merit|entrance|exam|class[\s_]?12|12th|10th|aadhaar|form|prospectus|placement|package|lateral|session|2026|2027|gnm|anm|dpt|pgdm|mca|b\.?com|m\.?com|d\.?pharm|b\.?pharm)';

  -- Check for vendor-related content
  v_is_vendor := v_msg ~* '(quotation|quote|vendor|supplier|supply|catalogue|catalog|brochure|rate[\s-]?card|price[\s-]?list|bulk|wholesale|partnership|tie[\s-]?up|collaboration|invoice|payment\s+terms|gst\s+number|company\s+profile|proposal|tender|contract|deal|distributor)';

  -- Decision logic: job takes priority if no admission keywords
  IF v_is_job AND NOT v_is_admission THEN
    v_category := 'job_applicant';
  ELSIF v_is_vendor AND NOT v_is_admission THEN
    v_category := 'vendor';
  ELSIF v_is_admission THEN
    v_category := 'lead'; -- confirmed admission
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

-- Re-run backfill with improved regex
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
  RAISE NOTICE 'Improved backfill: % job applicants, % vendors', v_job, v_vendor;
END $$;
