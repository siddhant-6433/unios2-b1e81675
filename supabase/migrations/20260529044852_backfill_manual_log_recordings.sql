-- Backfill: link manual_log call_logs rows to their real Plivo recording.
--
-- The lead-page "Cloud Call" button DID place a real Plivo call via the
-- manual-call edge function (ai_call_records row created with the real
-- voice-agent call_uuid; Plivo's recording callback populated recording_url
-- on that row). But the disposition save went through
-- src/lib/callDisposition.ts which passed crypto.randomUUID() as p_call_uuid
-- and 'manual_log' as p_call_source — so the call_logs row got a useless
-- random cloud_call_uuid and no path back to the recording.
--
-- The forward fix (callDisposition.ts accepts an explicit callUuid + source;
-- LeadDetail passes activeCallUuid) is in code. This migration patches the
-- historical rows: for every manual_log call_logs row, find the closest
-- ai_call_records row for the same lead within +/- 10 minutes that has a
-- recording_url, and re-key the call_logs row onto that ai_call_records'
-- call_uuid + flip source to 'cloud_dialer' so CallLog.tsx's join + badge
-- start showing recordings.
--
-- Idempotent: re-running only affects rows that still need linking.

DO $$
DECLARE
  v_row    RECORD;
  v_match  RECORD;
BEGIN
  FOR v_row IN
    SELECT id, lead_id, called_at, cloud_call_uuid
      FROM public.call_logs
     WHERE source = 'manual_log'
       AND recording_url IS NULL
  LOOP
    -- Find the closest ai_call_records row for this lead that:
    --   * has a recording
    --   * isn't already pointed at by another call_logs.cloud_call_uuid
    --     (so we don't violate the partial unique index on cloud_call_uuid)
    --   * is within +/- 10 minutes of the call_logs row's called_at
    SELECT a.call_uuid
      INTO v_match
      FROM public.ai_call_records a
     WHERE a.lead_id = v_row.lead_id
       AND a.recording_url IS NOT NULL
       AND a.call_uuid IS NOT NULL
       AND a.created_at BETWEEN v_row.called_at - interval '10 minutes'
                            AND v_row.called_at + interval '10 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.call_logs cl2
          WHERE cl2.cloud_call_uuid = a.call_uuid
            AND cl2.id <> v_row.id
       )
     ORDER BY ABS(EXTRACT(EPOCH FROM (a.created_at - v_row.called_at)))
     LIMIT 1;

    IF v_match.call_uuid IS NOT NULL THEN
      UPDATE public.call_logs
         SET cloud_call_uuid = v_match.call_uuid,
             source          = 'cloud_dialer'
       WHERE id = v_row.id;
    END IF;
  END LOOP;
END$$;
