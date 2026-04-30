-- ====================================================================
-- Branding templates: per-doc-type targeting
--   Each institution_branding row can now declare which document types
--   it applies to (offer_letter, receipt, admission_letter, application_form,
--   transcript, bona_fide, or "all" as catch-all). Multiple rows per
--   institution let you pick a different letterhead per document.
-- ====================================================================

ALTER TABLE public.institution_branding
  ADD COLUMN IF NOT EXISTS applies_to text[] NOT NULL DEFAULT ARRAY['all']::text[];

COMMENT ON COLUMN public.institution_branding.applies_to IS
  'Document types this template applies to. Tags: offer_letter, receipt, admission_letter, application_form, transcript, bona_fide, all. "all" matches every doc type.';

-- Updated resolver: prefers a campus-pinned template tagged with the
-- requested doc type, then any template tagged with the doc type, then
-- the default row tagged with the doc type, then any template tagged
-- "all", then the default row.
CREATE OR REPLACE FUNCTION public.lead_branding(_lead_id uuid, _doc_type text DEFAULT NULL)
RETURNS public.institution_branding
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT ib.*,
           CASE
             -- Campus-pinned + doc-type-specific = top priority.
             WHEN c.branding_slug IS NOT NULL AND c.branding_slug = ib.slug
                  AND _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to) THEN 0
             -- Campus-pinned + applies_to includes 'all'.
             WHEN c.branding_slug IS NOT NULL AND c.branding_slug = ib.slug
                  AND 'all' = ANY(ib.applies_to) THEN 1
             -- Any template with the specific doc type.
             WHEN _doc_type IS NOT NULL AND _doc_type = ANY(ib.applies_to) THEN 2
             -- Default row with doc type or 'all'.
             WHEN ib.is_default
                  AND (_doc_type IS NULL OR _doc_type = ANY(ib.applies_to) OR 'all' = ANY(ib.applies_to)) THEN 3
             -- Any 'all' template.
             WHEN 'all' = ANY(ib.applies_to) THEN 4
             ELSE 99
           END AS rank
      FROM public.institution_branding ib
      LEFT JOIN public.leads l ON l.id = _lead_id
      LEFT JOIN public.campuses c ON c.id = l.campus_id
  )
  SELECT id, slug, name, letterhead_url, footer_url, signature_url,
         signatory_name, signatory_designation, address, contact_email, contact_phone,
         website, gstin, is_default, created_at, updated_at, applies_to
    FROM ranked
   WHERE rank < 99
   ORDER BY rank
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lead_branding(uuid, text) TO authenticated, service_role;
