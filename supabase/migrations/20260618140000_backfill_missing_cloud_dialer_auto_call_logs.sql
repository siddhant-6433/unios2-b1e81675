-- Backfill Cloud Dialer auto-disposition calls that reached ai_call_records
-- but never got a matching call_logs row.
--
-- Forward fix #105 makes /bridge-hangup always call record_cloud_call_log()
-- for real student attempts, including auto-detected not-answered / busy /
-- voicemail outcomes. Historical rows can still be stranded in
-- ai_call_records only, which hides them from call logs and call metrics.
--
-- Deliberately excluded:
--   * counsellor_no_answer: the counsellor's own phone was not answered, so
--     the student was never dialed and the attempt should stay out of metrics.
--   * connected/completed calls without an auto disposition: those should be
--     explicitly dispositioned by the counsellor.
--   * rows already represented in call_logs, either by the canonical
--     cloud_call_uuid or by a very close manual log for the same lead/user.

WITH candidate_records AS (
  SELECT DISTINCT ON (acr.call_uuid)
         acr.call_uuid,
         acr.lead_id,
         COALESCE(acr.caller_user_id, acr.initiated_by) AS user_id,
         COALESCE(acr.duration_seconds, 0)              AS duration_seconds,
         acr.recording_url,
         COALESCE(acr.completed_at, acr.created_at)     AS called_at,
         CASE
           WHEN acr.disposition IN ('not_answered', 'no_answer') THEN 'not_answered'
           WHEN acr.disposition IN ('busy', 'voicemail', 'cancelled') THEN acr.disposition
           WHEN acr.disposition IS NULL AND acr.status = 'no_answer' THEN 'not_answered'
           WHEN acr.disposition IS NULL AND acr.status IN ('busy', 'voicemail') THEN acr.status
           ELSE NULL
         END AS disposition
    FROM public.ai_call_records acr
   WHERE acr.call_type = 'manual'
     AND acr.call_uuid IS NOT NULL
     AND acr.lead_id IS NOT NULL
     AND COALESCE(acr.disposition, acr.status) <> 'counsellor_no_answer'
     AND (
       acr.disposition IN ('not_answered', 'no_answer', 'busy', 'voicemail', 'cancelled')
       OR (acr.disposition IS NULL AND acr.status IN ('no_answer', 'busy', 'voicemail'))
     )
   ORDER BY acr.call_uuid,
            (acr.disposition IS NOT NULL) DESC,
            (acr.completed_at IS NOT NULL) DESC,
            acr.created_at DESC
),
missing_call_logs AS (
  SELECT cr.*
    FROM candidate_records cr
   WHERE cr.disposition IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.call_logs cl
        WHERE cl.cloud_call_uuid = cr.call_uuid
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.call_logs cl
        WHERE cl.lead_id = cr.lead_id
          AND cl.direction = 'outbound'
          AND cl.user_id IS NOT DISTINCT FROM cr.user_id
          AND cl.called_at BETWEEN cr.called_at - interval '2 minutes'
                              AND cr.called_at + interval '2 minutes'
          AND (
            cl.disposition = cr.disposition
            OR (cr.disposition = 'not_answered' AND cl.disposition = 'no_answer')
          )
     )
)
INSERT INTO public.call_logs (
  lead_id,
  user_id,
  direction,
  duration_seconds,
  disposition,
  recording_url,
  notes,
  cloud_call_uuid,
  source,
  called_at,
  created_at
)
SELECT lead_id,
       user_id,
       'outbound',
       duration_seconds,
       disposition,
       recording_url,
       'Cloud Call [' || left(call_uuid, 8) || ']: ' || replace(disposition, '_', ' ') || ' (backfilled)',
       call_uuid,
       'cloud_dialer',
       called_at,
       called_at
  FROM missing_call_logs
ON CONFLICT DO NOTHING;
