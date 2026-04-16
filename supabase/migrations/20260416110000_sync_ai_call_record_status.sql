-- When any ai_call_record is updated (status, recording, etc.), sync to all
-- sibling records with the same call_uuid. This handles the duplicate record
-- problem where voice-call function creates record #1 and voice-agent server
-- creates record #2, but only #2 gets updated on call completion.

CREATE OR REPLACE FUNCTION fn_sync_ai_call_siblings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only sync if this record was actually updated with meaningful data
  -- and has a call_uuid to match siblings
  IF NEW.call_uuid IS NOT NULL
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.recording_url IS DISTINCT FROM OLD.recording_url
          OR NEW.summary IS DISTINCT FROM OLD.summary
          OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
          OR NEW.disposition IS DISTINCT FROM OLD.disposition)
  THEN
    -- Update all sibling records with same call_uuid that have less data
    UPDATE ai_call_records
    SET
      status = CASE
        WHEN NEW.status <> 'initiated' AND ai_call_records.status = 'initiated'
        THEN NEW.status ELSE ai_call_records.status END,
      recording_url = COALESCE(ai_call_records.recording_url, NEW.recording_url),
      duration_seconds = CASE
        WHEN COALESCE(ai_call_records.duration_seconds, 0) = 0 AND COALESCE(NEW.duration_seconds, 0) > 0
        THEN NEW.duration_seconds ELSE ai_call_records.duration_seconds END,
      summary = COALESCE(ai_call_records.summary, NEW.summary),
      transcript = COALESCE(ai_call_records.transcript, NEW.transcript),
      disposition = COALESCE(ai_call_records.disposition, NEW.disposition),
      conversion_probability = COALESCE(ai_call_records.conversion_probability, NEW.conversion_probability),
      plivo_call_uuid = COALESCE(ai_call_records.plivo_call_uuid, NEW.plivo_call_uuid),
      completed_at = COALESCE(ai_call_records.completed_at, NEW.completed_at)
    WHERE call_uuid = NEW.call_uuid
      AND id <> NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ai_call_siblings ON ai_call_records;
CREATE TRIGGER trg_sync_ai_call_siblings
  AFTER UPDATE ON ai_call_records
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_ai_call_siblings();

-- Also: auto-deduplicate by removing the "empty" duplicate after sync
-- (keep the one with the most data, remove the skeleton)
CREATE OR REPLACE FUNCTION fn_cleanup_ai_call_duplicates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- After sync, if there are duplicate call_uuids, delete the one with less info
  -- Only clean up if the updated record now has meaningful status
  IF NEW.call_uuid IS NOT NULL AND NEW.status <> 'initiated' THEN
    DELETE FROM ai_call_records a
    WHERE a.call_uuid = NEW.call_uuid
      AND a.id <> NEW.id
      AND a.status = NEW.status
      AND COALESCE(a.recording_url, '') = COALESCE(NEW.recording_url, '')
      AND COALESCE(a.summary, '') = COALESCE(NEW.summary, '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_ai_call_duplicates ON ai_call_records;
CREATE TRIGGER trg_cleanup_ai_call_duplicates
  AFTER UPDATE ON ai_call_records
  FOR EACH ROW
  EXECUTE FUNCTION fn_cleanup_ai_call_duplicates();
