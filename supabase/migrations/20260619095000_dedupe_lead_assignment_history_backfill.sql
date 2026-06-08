-- Clean up any duplicate rows produced by the initial historical backfill if a
-- lead matched multiple campus institutions or JD category mappings.

WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY
        lead_id,
        assigned_to,
        created_at,
        assignment_source,
        bucket_name,
        lead_stage_at_assignment
      ORDER BY id
    ) AS row_num
  FROM public.lead_assignment_history
  WHERE assigned_by_profile_id IS NULL
    AND assigned_by_user_id IS NULL
    AND previous_counsellor_id IS NULL
    AND assignment_source = 'assigned'
)
DELETE FROM public.lead_assignment_history h
USING ranked r
WHERE h.ctid = r.ctid
  AND r.row_num > 1;

NOTIFY pgrst, 'reload schema';
