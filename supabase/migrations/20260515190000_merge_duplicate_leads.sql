-- ============================================================================
-- Merge duplicate leads by normalized phone number
-- 1. Normalize all phone numbers to +91XXXXXXXXXX format
-- 2. Merge duplicates: keep the most progressed (or oldest) lead, reassign children
-- 3. Add trigger to auto-normalize phone on insert/update
-- 4. Add unique index on normalized phone to prevent future duplicates
-- ============================================================================

-- Step 1: Normalize all existing phone numbers to +91XXXXXXXXXX
UPDATE leads
SET phone = '+91' || right(regexp_replace(phone, '\D', '', 'g'), 10)
WHERE phone IS NOT NULL
  AND length(regexp_replace(phone, '\D', '', 'g')) >= 10;

-- Step 2: Merge duplicates
DO $$
DECLARE
  v_norm_phone text;
  v_keep_id uuid;
  v_merge_rec record;
  v_keeper record;
  v_child_tables text[] := ARRAY[
    'ai_call_logs', 'ai_call_queue', 'ai_call_records', 'applications',
    'automation_rule_executions', 'call_logs', 'campus_visits',
    'consultant_payouts', 'counsellor_score_events', 'email_messages',
    'feedback_responses', 'lead_activities', 'lead_counsellors',
    'lead_deletion_requests', 'lead_documents', 'lead_followups',
    'lead_notes', 'lead_payments', 'notifications', 'offer_letters',
    'profile_queries', 'score_penalty_log', 'student_referrals',
    'students', 'visit_followup_nudges', 'waitlist_entries',
    'web_conversations', 'whatsapp_campaign_recipients', 'whatsapp_messages'
  ];
  v_tbl text;
  v_new_secondary text;
  v_new_tertiary text;
BEGIN
  FOR v_norm_phone IN
    SELECT phone AS np
    FROM leads
    WHERE phone IS NOT NULL
    GROUP BY phone
    HAVING count(*) > 1
  LOOP
    -- Keep the most progressed lead; oldest as tiebreaker
    SELECT id INTO v_keep_id
    FROM leads
    WHERE phone = v_norm_phone
    ORDER BY
      CASE stage::text
        WHEN 'admitted' THEN 12
        WHEN 'pre_admitted' THEN 11
        WHEN 'token_paid' THEN 10
        WHEN 'offer_sent' THEN 9
        WHEN 'interview' THEN 8
        WHEN 'visit_scheduled' THEN 7
        WHEN 'counsellor_call' THEN 6
        WHEN 'ai_called' THEN 5
        WHEN 'application_submitted' THEN 4
        WHEN 'application_in_progress' THEN 3
        WHEN 'new_lead' THEN 2
        WHEN 'deferred' THEN 1
        ELSE 0
      END DESC,
      created_at ASC
    LIMIT 1;

    -- Merge each duplicate into the keeper
    FOR v_merge_rec IN
      SELECT id, name, phone, source::text AS source, stage::text AS stage,
             counsellor_id, course_id, campus_id, email, notes,
             secondary_source, tertiary_source,
             source_history, created_at
      FROM leads
      WHERE phone = v_norm_phone
        AND id != v_keep_id
      ORDER BY created_at ASC
    LOOP
      -- Snapshot the merged lead
      INSERT INTO lead_merges (kept_lead_id, merged_lead_id, merged_lead_snapshot)
      VALUES (v_keep_id, v_merge_rec.id, row_to_json(v_merge_rec)::jsonb);

      -- Read current keeper state
      SELECT source::text, secondary_source, tertiary_source,
             source_history, email, course_id, campus_id, counsellor_id
      INTO v_keeper
      FROM leads WHERE id = v_keep_id;

      -- Determine source slot updates
      v_new_secondary := v_keeper.secondary_source;
      v_new_tertiary := v_keeper.tertiary_source;

      IF v_merge_rec.source != v_keeper.source
         AND v_merge_rec.source != COALESCE(v_keeper.secondary_source, '')
         AND v_merge_rec.source != COALESCE(v_keeper.tertiary_source, '') THEN
        IF v_keeper.secondary_source IS NULL THEN
          v_new_secondary := v_merge_rec.source;
        ELSIF v_keeper.tertiary_source IS NULL THEN
          v_new_tertiary := v_merge_rec.source;
        END IF;
      END IF;

      -- Update keeper
      UPDATE leads SET
        secondary_source = v_new_secondary,
        tertiary_source = v_new_tertiary,
        source_history = COALESCE(v_keeper.source_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'source', v_merge_rec.source,
          'timestamp', v_merge_rec.created_at,
          'merged_from', v_merge_rec.id,
          'original_name', v_merge_rec.name
        )),
        email = COALESCE(v_keeper.email, v_merge_rec.email),
        course_id = COALESCE(v_keeper.course_id, v_merge_rec.course_id),
        campus_id = COALESCE(v_keeper.campus_id, v_merge_rec.campus_id),
        counsellor_id = COALESCE(v_keeper.counsellor_id, v_merge_rec.counsellor_id)
      WHERE id = v_keep_id;

      -- Reassign all child records
      FOREACH v_tbl IN ARRAY v_child_tables
      LOOP
        EXECUTE format(
          'UPDATE %I SET lead_id = $1 WHERE lead_id = $2',
          v_tbl
        ) USING v_keep_id, v_merge_rec.id;
      END LOOP;

      -- Clear mirror references
      UPDATE leads SET mirror_lead_id = NULL WHERE mirror_lead_id = v_merge_rec.id;

      -- Log the merge
      INSERT INTO lead_activities (lead_id, type, description)
      VALUES (v_keep_id, 'system',
        'Merged duplicate lead (ID: ' || v_merge_rec.id || ', name: ' || COALESCE(v_merge_rec.name, '?') || ', source: ' || v_merge_rec.source || ')');

      -- Delete the merged lead
      DELETE FROM leads WHERE id = v_merge_rec.id;
    END LOOP;
  END LOOP;
END $$;

-- Step 3: Trigger to auto-normalize phone on insert/update
CREATE OR REPLACE FUNCTION public.normalize_lead_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  digits text;
BEGIN
  IF NEW.phone IS NOT NULL THEN
    digits := regexp_replace(NEW.phone, '\D', '', 'g');
    IF length(digits) >= 10 THEN
      NEW.phone := '+91' || right(digits, 10);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_lead_phone ON leads;
CREATE TRIGGER trg_normalize_lead_phone
  BEFORE INSERT OR UPDATE OF phone ON leads
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_lead_phone();

-- Step 4: Unique index on phone to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_unique ON leads (phone)
  WHERE phone IS NOT NULL;
