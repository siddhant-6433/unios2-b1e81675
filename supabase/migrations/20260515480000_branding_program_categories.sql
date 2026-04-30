-- ====================================================================
-- Branding scoped to specific program categories
--   E.g. "NIMT Higher Education" branding only applies when an
--   application's program_category is undergraduate / postgraduate /
--   mba_pgdm / professional / bed / deled. School applications skip
--   it and fall back to the default branding.
-- ====================================================================

ALTER TABLE public.institution_branding
  ADD COLUMN IF NOT EXISTS program_categories text[];

COMMENT ON COLUMN public.institution_branding.program_categories IS
  'When set, this branding only applies to applications whose program_category is in the array. NULL = applies to any program.';

-- Updated resolver: prefers a row whose applies_to matches the doc type
-- AND whose program_categories array includes the lead's program_category
-- (if the lead has a linked application).
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
             -- Campus-pinned + doc-type-specific + program-category match
             WHEN lc.branding_slug = ib.slug
                  AND _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 0
             -- Campus-pinned + 'all'
             WHEN lc.branding_slug = ib.slug
                  AND 'all' = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 1
             -- Any doc-type match with program-category match
             WHEN _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 2
             -- Default + doc-type-specific or 'all' (program-category-aware)
             WHEN ib.is_default
                  AND (_doc_type IS NULL OR _doc_type = ANY(ib.applies_to) OR 'all' = ANY(ib.applies_to))
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 3
             -- Any 'all' template program-category-aware
             WHEN 'all' = ANY(ib.applies_to)
                  AND (ib.program_categories IS NULL OR lc.program_category = ANY(ib.program_categories))
                  THEN 4
             -- Default unconditional fallback
             WHEN ib.is_default THEN 5
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

-- Seed the NIMT Higher Education branding for application-form PDFs.
INSERT INTO public.institution_branding
  (slug, name, letterhead_url, footer_url, applies_to, program_categories,
   address, contact_email, contact_phone, website)
VALUES (
  'nimt_he',
  'NIMT Higher Education - Application Form',
  'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/application-documents/branding/nimt_he/letterhead.png',
  'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/application-documents/branding/nimt_he/footer.png',
  ARRAY['application_form']::text[],
  ARRAY['undergraduate','postgraduate','mba_pgdm','professional','bed','deled']::text[],
  'Greater Noida - Ghaziabad - Kotputli, Jaipur',
  'support@nimt.ac.in',
  '(9555) 192 192',
  'https://www.nimt.ac.in'
)
ON CONFLICT (slug) DO UPDATE SET
  letterhead_url     = EXCLUDED.letterhead_url,
  footer_url         = EXCLUDED.footer_url,
  applies_to         = EXCLUDED.applies_to,
  program_categories = EXCLUDED.program_categories,
  updated_at         = now();
