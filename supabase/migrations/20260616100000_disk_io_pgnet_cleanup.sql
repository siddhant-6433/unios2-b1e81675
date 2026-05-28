-- Disk IO mitigation: net._http_response was 292 MB heap for only 1,035 rows
-- (last 6 hours of pg_net callbacks). pg_net 0.20.0 does not auto-prune.
-- One-time VACUUM FULL was run separately (reclaimed 296 MB).
-- This migration schedules a 15-minute prune so bloat does not recur.
--
-- Note: ALTER TABLE net._http_response SET (autovacuum_*) for tighter
-- autovacuum requires table-owner privileges (supabase_admin) and cannot be
-- applied from the migration role. Open a Supabase support ticket if you
-- want aggressive per-table autovacuum on top of this cron prune.

SELECT cron.schedule(
  'cleanup-pgnet-http-response',
  '*/15 * * * *',
  $$ DELETE FROM net._http_response WHERE created < now() - interval '2 hours' $$
);
