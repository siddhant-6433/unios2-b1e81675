-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260724112459 name=fix_lead_branding_return_columns applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.lead_branding(_lead_id uuid, _doc_type text DEFAULT NULL)
RETURNS public.institution_branding
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lead_ctx AS (
    SELECT l.id, l.campus_id, c.branding_slug,
           (SELECT a.program_category FROM public.applications a
             WHERE a.lead_id = l.id ORDER BY a.created_at DESC LIMIT 1) AS program_category
      FROM public.leads l
      LEFT JOIN public.campuses c ON c.id = l.campus_id
     WHERE l.id = _lead_id
  ),
  ranked AS (
    SELECT ib.id,
           CASE
             WHEN ib.program_categories IS NOT NULL
                  AND lc.program_category = ANY(ib.program_categories)
                  AND _doc_type IS NOT NULL
                  AND _doc_type = ANY(ib.applies_to) THEN 0
             WHEN lc.branding_slug = ib.slug
                  AND _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 1
             WHEN lc.branding_slug = ib.slug
                  AND 'all' = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 2
             WHEN _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to)
                  AND ib.program_categories IS NULL
                  THEN 3
             WHEN ib.is_default
                  AND (_doc_type IS NULL OR _doc_type = ANY(ib.applies_to) OR 'all' = ANY(ib.applies_to))
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 4
             WHEN 'all' = ANY(ib.applies_to) AND ib.program_categories IS NULL THEN 5
             WHEN ib.is_default THEN 6
             ELSE 99
           END AS rank
      FROM public.institution_branding ib
      LEFT JOIN lead_ctx lc ON true
  )
  SELECT ib.*
    FROM public.institution_branding ib
    JOIN ranked r ON r.id = ib.id
   WHERE r.rank < 99
   ORDER BY r.rank
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lead_branding(uuid, text) TO authenticated, service_role;
