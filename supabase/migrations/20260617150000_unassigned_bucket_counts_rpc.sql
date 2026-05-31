-- Collapse the 15 parallel count queries fired by LeadBuckets.fetchCounts()
-- into a single DB round-trip.
--
-- The old approach issued 3 bucket-total counts + 3×4 = 12 source-breakdown
-- counts against `unassigned_leads_bucket`, each re-running the full 6-table
-- join + DISTINCT ON over ai_call_records. On a 2,900+ lead bucket this meant
-- ~15 full multi-join recomputations per page load, which was the dominant
-- source of "keeps loading" slowness on mobile.
--
-- This function does one pass through get_unassigned_leads_bucket() and returns
-- every (bucket_key, source_key, count) combination. The client aggregates the
-- totals and source breakdown in memory from that single result set.

CREATE OR REPLACE FUNCTION public.unassigned_bucket_counts()
RETURNS TABLE (bucket_key text, source_key text, n bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN bucket = 'college' THEN 'college'
      ELSE school_brand          -- 'nimt' or 'mirai' for school bucket
    END                          AS bucket_key,
    CASE
      WHEN source IN ('web_chat', 'website_chat') THEN 'web_chat'
      ELSE source
    END                          AS source_key,
    count(*)::bigint             AS n
  FROM public.get_unassigned_leads_bucket()
  GROUP BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION public.unassigned_bucket_counts() TO authenticated;
