-- Update auto_categorize to also log training data when it categorizes
-- This way the model learns from both manual AND automatic categorizations

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
  v_learned_job int;
  v_learned_vendor int;
  v_learned_admission int;
BEGIN
  IF _lead_id IS NULL OR _message_text IS NULL OR _message_text = '' THEN
    RETURN null;
  END IF;

  SELECT person_role INTO v_current_role FROM leads WHERE id = _lead_id;
  IF v_current_role IS DISTINCT FROM 'lead' THEN
    RETURN v_current_role;
  END IF;

  v_msg := lower(_message_text);

  -- Step 1: Hardcoded regex
  v_is_job := v_msg ~* '(job|vacancy|hiring|salary|resume|cv|naukri|rozgar|kaam\s+chahiye|kaam\s+mil|openings?|recruit|walk[\s-]?in|joining|fresher|experience|ctc|stipend|working|work\s+from|intern|in[\s-]?hand|position|employ|staff\s+required|teacher\s+wanted|faculty\s+required|peon|driver|guard|helper|clerk|office\s+boy|receptionist)';
  v_is_admission := v_msg ~* '(admission|course|fee|fees|seat|hostel|scholarship|apply|enroll|campus|visit|counsellor|nursing|bpt|mba|bba|bca|pharma|law|llb|btech|b\.?sc|m\.?sc|bed|b\.?ed|college|university|degree|diploma|eligibility|cutoff|cut[\s-]?off|merit|entrance|exam|class[\s_]?12|12th|10th|form|prospectus|placement|package|lateral|session|2026|2027|gnm|anm|dpt|pgdm|mca|b\.?com|m\.?com|d\.?pharm|b\.?pharm)';
  v_is_vendor := v_msg ~* '(quotation|quote|vendor|supplier|supply|catalogue|catalog|brochure|rate[\s-]?card|price[\s-]?list|bulk|wholesale|partnership|tie[\s-]?up|collaboration|invoice|payment\s+terms|gst\s+number|company\s+profile|proposal|tender|contract|deal|distributor)';

  IF v_is_job AND NOT v_is_admission THEN
    v_category := 'job_applicant';
  ELSIF v_is_vendor AND NOT v_is_admission THEN
    v_category := 'vendor';
  ELSIF v_is_admission THEN
    v_category := 'lead';
  END IF;

  -- Step 2: Learned keywords (if hardcoded didn't match)
  IF v_category IS NULL THEN
    SELECT COUNT(*) INTO v_learned_job FROM wa_category_keywords k
      WHERE k.category = 'job_applicant' AND k.frequency >= 2
        AND v_msg ~* ('\m' || k.keyword || '\M');
    SELECT COUNT(*) INTO v_learned_vendor FROM wa_category_keywords k
      WHERE k.category = 'vendor' AND k.frequency >= 2
        AND v_msg ~* ('\m' || k.keyword || '\M');
    SELECT COUNT(*) INTO v_learned_admission FROM wa_category_keywords k
      WHERE k.category = 'lead' AND k.frequency >= 2
        AND v_msg ~* ('\m' || k.keyword || '\M');

    IF v_learned_job >= 2 AND v_learned_job > v_learned_admission AND v_learned_job > v_learned_vendor THEN
      v_category := 'job_applicant';
    ELSIF v_learned_vendor >= 2 AND v_learned_vendor > v_learned_admission AND v_learned_vendor > v_learned_job THEN
      v_category := 'vendor';
    ELSIF v_learned_admission >= 2 THEN
      v_category := 'lead';
    END IF;
  END IF;

  -- Apply categorization
  IF v_category IS NOT NULL AND v_category != 'lead' THEN
    UPDATE leads
    SET person_role = v_category, stage = 'not_interested'
    WHERE id = _lead_id AND person_role = 'lead';
  END IF;

  -- Log training data for ALL categorizations (auto + manual feed the model)
  IF v_category IS NOT NULL AND length(_message_text) > 5 THEN
    PERFORM public.log_category_training(v_category, _message_text, null);
  END IF;

  RETURN COALESCE(v_category, 'lead');
END;
$$;

-- Seed initial training from existing categorized leads
-- This bootstraps the learned keywords from leads already categorized
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT l.person_role AS category,
           string_agg(wm.content, ' ' ORDER BY wm.created_at DESC) AS msgs
    FROM leads l
    INNER JOIN whatsapp_messages wm ON wm.lead_id = l.id
    WHERE l.person_role IN ('job_applicant', 'vendor')
      AND wm.direction = 'inbound'
      AND wm.content IS NOT NULL AND wm.content != ''
    GROUP BY l.id, l.person_role
  LOOP
    PERFORM public.log_category_training(r.category, r.msgs, null);
  END LOOP;
END $$;
