-- Learning system for WhatsApp message categorization
-- Stores manual categorization examples and extracts keywords per category

-- 1. Training examples table
CREATE TABLE IF NOT EXISTS public.wa_category_training (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('lead', 'job_applicant', 'vendor', 'other')),
  message_text text NOT NULL,
  phone text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_wa_cat_training_category ON wa_category_training(category);
ALTER TABLE wa_category_training ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage training data" ON wa_category_training FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 2. Learned keywords table (aggregated from training)
CREATE TABLE IF NOT EXISTS public.wa_category_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  keyword text NOT NULL,
  frequency int DEFAULT 1,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (category, keyword)
);

ALTER TABLE wa_category_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read keywords" ON wa_category_keywords FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can manage keywords" ON wa_category_keywords FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 3. Function to log training example and extract keywords
CREATE OR REPLACE FUNCTION public.log_category_training(
  _category text,
  _message_text text,
  _phone text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_word text;
  v_stop_words text[] := ARRAY[
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','shall','should','may','might','can','could',
    'i','me','my','we','our','you','your','he','she','it','they','them','their',
    'this','that','these','those','what','which','who','whom','how','where','when',
    'and','or','but','if','then','so','no','not','yes','hi','hello','ok','okay',
    'sir','mam','madam','please','thank','thanks','ji','haan','nahi','kya','hai',
    'ka','ki','ke','ko','se','me','ye','wo','to','par','bhi','aur','ya',
    'for','of','in','on','at','by','from','with','about','into','through',
    'nimt','educational','institutions','institution','campus','greater','noida'
  ];
BEGIN
  -- Store training example
  INSERT INTO wa_category_training (category, message_text, phone) VALUES (_category, _message_text, _phone);

  -- Extract words (3+ chars, not stop words) and upsert as keywords
  FOR v_word IN
    SELECT DISTINCT lower(w) FROM regexp_split_to_table(lower(_message_text), '\s+|[,.\?!:;()\[\]{}"/]+') w
    WHERE length(w) >= 3
      AND w ~ '^[a-z]+$'
      AND NOT (lower(w) = ANY(v_stop_words))
  LOOP
    INSERT INTO wa_category_keywords (category, keyword, frequency, updated_at)
    VALUES (_category, v_word, 1, now())
    ON CONFLICT (category, keyword) DO UPDATE SET
      frequency = wa_category_keywords.frequency + 1,
      updated_at = now();
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_category_training TO authenticated;

-- 4. Update auto_categorize to also use learned keywords
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
  v_learned_other int;
BEGIN
  IF _lead_id IS NULL OR _message_text IS NULL OR _message_text = '' THEN
    RETURN null;
  END IF;

  SELECT person_role INTO v_current_role FROM leads WHERE id = _lead_id;
  IF v_current_role IS DISTINCT FROM 'lead' THEN
    RETURN v_current_role;
  END IF;

  v_msg := lower(_message_text);

  -- Step 1: Hardcoded regex (high confidence)
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
    -- Count matching learned keywords per category (only keywords with frequency >= 2)
    SELECT COUNT(*) INTO v_learned_job FROM wa_category_keywords k
      WHERE k.category = 'job_applicant' AND k.frequency >= 2
        AND v_msg ~* ('\m' || k.keyword || '\M');

    SELECT COUNT(*) INTO v_learned_vendor FROM wa_category_keywords k
      WHERE k.category = 'vendor' AND k.frequency >= 2
        AND v_msg ~* ('\m' || k.keyword || '\M');

    SELECT COUNT(*) INTO v_learned_admission FROM wa_category_keywords k
      WHERE k.category = 'lead' AND k.frequency >= 2
        AND v_msg ~* ('\m' || k.keyword || '\M');

    -- Need 2+ matching learned keywords to categorize (avoids false positives)
    IF v_learned_job >= 2 AND v_learned_job > v_learned_admission AND v_learned_job > v_learned_vendor THEN
      v_category := 'job_applicant';
    ELSIF v_learned_vendor >= 2 AND v_learned_vendor > v_learned_admission AND v_learned_vendor > v_learned_job THEN
      v_category := 'vendor';
    ELSIF v_learned_admission >= 2 THEN
      v_category := 'lead';
    END IF;
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
