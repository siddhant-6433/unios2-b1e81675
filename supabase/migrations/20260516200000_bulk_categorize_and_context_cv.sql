-- 1. Add context for resume/cv (job unless "submit documents for admission")
-- Already handled in the function but let's make it explicit

-- 2. Bulk categorize function — runs on inbox load for all uncategorized leads
CREATE OR REPLACE FUNCTION public.bulk_categorize_wa_leads()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_result text;
  v_job int := 0;
  v_vendor int := 0;
  v_total int := 0;
BEGIN
  FOR r IN
    SELECT l.id AS lead_id,
           string_agg(wm.content, ' ' ORDER BY wm.created_at DESC) AS all_messages
    FROM leads l
    INNER JOIN whatsapp_messages wm ON wm.lead_id = l.id
    WHERE wm.direction = 'inbound'
      AND wm.content IS NOT NULL AND wm.content != '' AND wm.content != '[unsupported]'
      AND l.person_role = 'lead'
    GROUP BY l.id
    LIMIT 500 -- process in batches to avoid timeout
  LOOP
    v_total := v_total + 1;
    v_result := public.auto_categorize_lead_from_message(r.lead_id, r.all_messages);
    IF v_result = 'job_applicant' THEN v_job := v_job + 1;
    ELSIF v_result = 'vendor' THEN v_vendor := v_vendor + 1;
    END IF;
  END LOOP;

  RETURN json_build_object('scanned', v_total, 'job', v_job, 'vendor', v_vendor);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_categorize_wa_leads() TO authenticated;

-- Also update auto_categorize: make resume/cv context-aware
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
  v_job_score int := 0;
  v_admission_score int := 0;
  v_vendor_score int := 0;
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

  -- ═══ JOB SIGNALS ═══
  -- Strong (always job)
  IF v_msg ~* '(vacancy|hiring|naukri|rozgar|kaam\s+chahiye|kaam\s+mil|recruit|staff\s+required|teacher\s+wanted|faculty\s+required|peon|driver|guard|helper|clerk|office\s+boy|receptionist|ctc|stipend|work\s+from\s+home)' THEN
    v_job_score := v_job_score + 3;
  END IF;
  -- Moderate
  IF v_msg ~* '\m(job|salary|working|joining|fresher|employ|position|openings?|intern)\M' THEN
    v_job_score := v_job_score + 2;
  END IF;
  -- Context: "resume/cv" = job UNLESS "upload documents/submit for admission"
  IF v_msg ~* '\m(resume|cv)\M' AND NOT v_msg ~* '(upload|submit|document|admission|application)\s.{0,20}(resume|cv)' THEN
    v_job_score := v_job_score + 2;
  END IF;
  -- Context: "interview" = job UNLESS admission context
  IF v_msg ~* '\minterview\M' AND NOT v_msg ~* '(admission|campus|counsellor|round)\s.{0,10}interview' AND NOT v_msg ~* 'interview\s.{0,10}(admission|round|campus)' THEN
    v_job_score := v_job_score + 2;
  END IF;
  -- Context: "in-hand/inhand" = job (salary context)
  IF v_msg ~* '(in[\s-]?hand|\d+k|\d+\s*lpa)' THEN
    v_job_score := v_job_score + 2;
  END IF;
  -- Context: "training" = job UNLESS clinical
  IF v_msg ~* '\mtraining\M' AND NOT v_msg ~* '(clinical|nursing|hospital|internship|practical)\s+training' THEN
    v_job_score := v_job_score + 1;
  END IF;
  -- Context: "experience" = job UNLESS education context
  IF v_msg ~* '\mexperience\M' AND NOT v_msg ~* '(year|learning|campus|student)\s+experience' THEN
    v_job_score := v_job_score + 1;
  END IF;

  -- ═══ ADMISSION SIGNALS ═══
  IF v_msg ~* '(admission|course|fees?|seat|hostel|scholarship|enroll|counsellor|eligibility|cutoff|cut[\s-]?off|merit|entrance\s+exam|prospectus|lateral\s+entry)' THEN
    v_admission_score := v_admission_score + 3;
  END IF;
  IF v_msg ~* '(nursing|bpt|mba|bba|bca|pharma|law|llb|btech|b\.?sc|m\.?sc|bed|b\.?ed|gnm|anm|dpt|pgdm|mca|b\.?com|m\.?com|d\.?pharm|b\.?pharm)' THEN
    v_admission_score := v_admission_score + 3;
  END IF;
  IF v_msg ~* '(college|university|degree|diploma|class[\s_]?12|12th|10th|form|placement|package|session|2026|2027|campus\s+visit|apply)' THEN
    v_admission_score := v_admission_score + 2;
  END IF;

  -- ═══ VENDOR SIGNALS ═══
  IF v_msg ~* '(quotation|quote|vendor|supplier|supply|catalogue|catalog|rate[\s-]?card|price[\s-]?list|bulk|wholesale|partnership|tie[\s-]?up|collaboration|invoice|payment\s+terms|gst\s+number|company\s+profile|proposal|tender|contract|distributor)' THEN
    v_vendor_score := v_vendor_score + 3;
  END IF;

  -- ═══ DECISION ═══
  IF v_admission_score >= 3 THEN
    v_category := 'lead';
  ELSIF v_job_score >= 3 AND v_job_score > v_admission_score THEN
    v_category := 'job_applicant';
  ELSIF v_vendor_score >= 3 AND v_vendor_score > v_admission_score THEN
    v_category := 'vendor';
  ELSIF v_job_score >= 2 AND v_admission_score = 0 THEN
    v_category := 'job_applicant';
  ELSIF v_vendor_score >= 2 AND v_admission_score = 0 THEN
    v_category := 'vendor';
  END IF;

  -- Step 2: Learned keywords
  IF v_category IS NULL THEN
    SELECT COUNT(*) INTO v_learned_job FROM wa_category_keywords k
      WHERE k.category = 'job_applicant' AND k.frequency >= 2 AND v_msg ~* ('\m' || k.keyword || '\M');
    SELECT COUNT(*) INTO v_learned_vendor FROM wa_category_keywords k
      WHERE k.category = 'vendor' AND k.frequency >= 2 AND v_msg ~* ('\m' || k.keyword || '\M');
    SELECT COUNT(*) INTO v_learned_admission FROM wa_category_keywords k
      WHERE k.category = 'lead' AND k.frequency >= 2 AND v_msg ~* ('\m' || k.keyword || '\M');

    IF v_learned_job >= 2 AND v_learned_job > v_learned_admission THEN v_category := 'job_applicant';
    ELSIF v_learned_vendor >= 2 AND v_learned_vendor > v_learned_admission THEN v_category := 'vendor';
    ELSIF v_learned_admission >= 2 THEN v_category := 'lead';
    END IF;
  END IF;

  IF v_category IS NOT NULL AND v_category != 'lead' THEN
    UPDATE leads SET person_role = v_category, stage = 'not_interested'
    WHERE id = _lead_id AND person_role = 'lead';
  END IF;

  IF v_category IS NOT NULL AND length(_message_text) > 5 THEN
    PERFORM public.log_category_training(v_category, _message_text, null);
  END IF;

  RETURN COALESCE(v_category, 'lead');
END;
$$;
