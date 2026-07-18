-- Fix: lead_branding(uuid, text) broke when the TC workflow (2026-07-09) added
-- 6 columns to institution_branding (affiliation_no, principal_name, seal_url,
-- tc_serial_prefix, school_code, principal_user_id). The function RETURNS the
-- full institution_branding row type but its final SELECT still enumerated only
-- the original 18 columns, so every call failed at runtime with
-- "Final statement returns too few columns". Edge functions swallow the error
-- → branding is null → offer letters / application forms lose their letterhead
-- logo and fall back to the plain navy text band.
--
-- Rank by id only, then select the whole row back from the table, so future
-- column additions can never re-break the return-type match.

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
             -- 0. Most specific: explicit program_categories MATCH + doc-type match.
             WHEN ib.program_categories IS NOT NULL
                  AND lc.program_category = ANY(ib.program_categories)
                  AND _doc_type IS NOT NULL
                  AND _doc_type = ANY(ib.applies_to) THEN 0
             -- 1. Campus-pinned + doc-type-specific (no program restriction, or restriction passes).
             WHEN lc.branding_slug = ib.slug
                  AND _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 1
             -- 2. Campus-pinned + 'all'.
             WHEN lc.branding_slug = ib.slug
                  AND 'all' = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 2
             -- 3. Any doc-type-specific row (no program restriction).
             WHEN _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to)
                  AND ib.program_categories IS NULL
                  THEN 3
             -- 4. Default with doc-type or 'all'.
             WHEN ib.is_default
                  AND (_doc_type IS NULL OR _doc_type = ANY(ib.applies_to) OR 'all' = ANY(ib.applies_to))
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 4
             -- 5. Any 'all' template (no program restriction).
             WHEN 'all' = ANY(ib.applies_to) AND ib.program_categories IS NULL THEN 5
             -- 6. Default fallback unconditionally.
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
