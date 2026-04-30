-- Re-rank branding resolver so a row that explicitly targets BOTH the doc type
-- and the program category outranks a campus-pinned generic-applies_to row.
-- A specific "NIMT Higher Education - Application Form" template (applies_to
-- = application_form, program_categories = [...]) should win over the campus
-- default for higher-ed applications, but the campus default still wins for
-- school applications because the program-category check fails.

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
    SELECT ib.*,
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
  SELECT id, slug, name, letterhead_url, footer_url, signature_url,
         signatory_name, signatory_designation, address, contact_email, contact_phone,
         website, gstin, is_default, created_at, updated_at, applies_to,
         program_categories
    FROM ranked
   WHERE rank < 99
   ORDER BY rank
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lead_branding(uuid, text) TO authenticated, service_role;
