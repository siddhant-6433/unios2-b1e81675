-- Fix ai_call_records stuck at "initiated" status
-- These records were never updated because the voice-agent server's /status/ callback
-- was creating duplicate records instead of updating the original.
--
-- Strategy:
-- 1. For records older than 10 minutes with plivo_call_uuid — mark as "completed"
--    (the call happened but status wasn't updated)
-- 2. For records older than 10 minutes without plivo_call_uuid — mark as "no_answer"
--    (the call likely never connected)
-- 3. Remove duplicate records (same call_uuid, keep the one with more data)

-- Step 1: Update stale "initiated" records that have a plivo UUID (call definitely happened)
UPDATE ai_call_records
SET status = 'completed',
    completed_at = COALESCE(completed_at, now())
WHERE status = 'initiated'
  AND plivo_call_uuid IS NOT NULL
  AND created_at < now() - interval '10 minutes';

-- Step 2: Update stale "initiated" records without plivo UUID
UPDATE ai_call_records
SET status = 'no_answer',
    completed_at = COALESCE(completed_at, now())
WHERE status = 'initiated'
  AND plivo_call_uuid IS NULL
  AND created_at < now() - interval '10 minutes';

-- Step 3: Remove duplicate records - for each call_uuid, keep only the one with the most data
-- (prefer the one with recording_url, then the one with summary, then the newest)
DELETE FROM ai_call_records a
USING ai_call_records b
WHERE a.call_uuid = b.call_uuid
  AND a.call_uuid IS NOT NULL
  AND a.id <> b.id
  AND (
    -- b has recording but a doesn't → delete a
    (b.recording_url IS NOT NULL AND a.recording_url IS NULL)
    OR
    -- both have same recording status, but b has summary and a doesn't → delete a
    (COALESCE(b.recording_url, '') = COALESCE(a.recording_url, '')
     AND b.summary IS NOT NULL AND a.summary IS NULL)
    OR
    -- both have same data, keep the one with non-initiated status
    (COALESCE(b.recording_url, '') = COALESCE(a.recording_url, '')
     AND COALESCE(b.summary, '') = COALESCE(a.summary, '')
     AND b.status <> 'initiated' AND a.status = 'initiated')
    OR
    -- all else equal, keep the older one (first created)
    (COALESCE(b.recording_url, '') = COALESCE(a.recording_url, '')
     AND COALESCE(b.summary, '') = COALESCE(a.summary, '')
     AND b.status = a.status
     AND a.created_at > b.created_at)
  );
