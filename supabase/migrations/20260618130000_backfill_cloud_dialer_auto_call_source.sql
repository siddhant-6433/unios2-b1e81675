-- Backfill Cloud Dialer auto-disposition rows whose durable server-side
-- bridge-hangup write predated p_call_source attribution.
--
-- These rows were still real call_logs entries, but source stayed NULL unless
-- the browser poller later merged the row. Cloud Dialer usage metrics exclude
-- NULL source rows, so automatically detected no-answer/busy/voicemail calls
-- could disappear from adoption reporting.

UPDATE public.call_logs
   SET source = 'cloud_dialer'
 WHERE source IS NULL
   AND direction = 'outbound'
   AND cloud_call_uuid IS NOT NULL
   AND notes ~* '^Cloud Call \[[a-f0-9]{8}\]:';
