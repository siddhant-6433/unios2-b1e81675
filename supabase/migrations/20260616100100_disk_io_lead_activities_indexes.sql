-- Disk IO mitigation: top three lead_activities queries by total exec time
-- filter on (type, created_at) and (user_id, type, created_at). Existing
-- indexes are (lead_id, created_at) and a recent-created index — neither has
-- `type` as a leading column, so the planner falls back to wide scans.
--
-- Hot queries (from pg_stat_statements):
--   1. 5.4K calls @ 920 ms avg : WHERE type=$1 AND created_at>=$2 ORDER BY created_at LIMIT
--   2. 4.2K calls @ 257 ms avg : WHERE type=$1 AND created_at>=$2 AND lead_id = ANY($3) ORDER BY created_at LIMIT
--   3. 629  calls @ 2.1 s  avg : WHERE user_id=$1 AND type=$2 AND created_at>=$3 LIMIT
--
-- On prod these were built with CREATE INDEX CONCURRENTLY via execute_sql to
-- avoid locking the hot table. The plain CREATE INDEX IF NOT EXISTS below is
-- a no-op on prod and lets a fresh DB (staging/local) build them in-transaction.

CREATE INDEX IF NOT EXISTS idx_lead_activities_type_created
  ON public.lead_activities (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_activities_user_type_created
  ON public.lead_activities (user_id, type, created_at DESC);
