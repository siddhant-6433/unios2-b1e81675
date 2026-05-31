-- Performance indexes to speed up the unassigned-bucket query path.
--
-- (1) Partial index on leads for the bucket function's core predicate.
--     get_unassigned_leads_bucket() filters: counsellor_id IS NULL AND
--     is_mirror = false. The existing idx_leads_counsellor_created_all covers
--     non-null counsellor_id; there is no index that efficiently scans the
--     NULL (unassigned) side, so every bucket call was a full seq scan.
CREATE INDEX IF NOT EXISTS idx_leads_unassigned
  ON public.leads (created_at ASC)
  WHERE counsellor_id IS NULL AND is_mirror = false;

-- (2) Index on ai_call_records for the DISTINCT ON (lead_id) ORDER BY
--     lead_id, created_at DESC pattern in the latest_ai CTE inside
--     get_unassigned_leads_bucket(). Without this, every bucket call does a
--     full sequential scan of ai_call_records just to find the latest
--     AI summary per lead.
CREATE INDEX IF NOT EXISTS idx_ai_call_records_lead_summary
  ON public.ai_call_records (lead_id, created_at DESC)
  WHERE summary IS NOT NULL;
