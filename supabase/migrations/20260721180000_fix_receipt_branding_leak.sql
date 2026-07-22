-- Receipts showed the wrong campus address (e.g. a Greater Noida nursing token
-- receipt printed "NIMT School, Avantika II, Ghaziabad").
--
-- Root cause: the default `nimt` branding row's applies_to does NOT include
-- 'receipt' or 'all', so for the receipt doc-type a lead on a campus with no
-- branding_slug never resolved at rank ≤4 and fell to rank 5 — "any 'all'
-- template". The three campus-pinned school rows (nimt_grn, nimt_school_arthala,
-- nimt_school_avantika2) all carry applies_to=['all'], so rank 5 was an
-- ARBITRARY tie between them; it happened to pick Avantika II for every
-- null-branding campus (Greater Noida, Kotputli, Ghaziabad-2).
--
-- Two fixes:
--   1. Pin Greater Noida to its existing dedicated branding (nimt_grn) so its
--      receipts carry the real Greater Noida address, not a fallback.
--   2. rank 5 now excludes rows that are pinned to a campus — a campus-scoped
--      branding must reach a lead only through its own campus (rank 2), never
--      leak globally. Remaining null-branding campuses fall to the default
--      (rank 6). Also add a deterministic tiebreak so no future tie is random.

UPDATE public.campuses SET branding_slug = 'nimt_grn' WHERE code = 'GN';

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
    SELECT ib.id, ib.is_default,
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
             -- 5. Any 'all' template (no program restriction) that is NOT pinned
             --    to a campus. A campus-scoped branding must reach a lead only
             --    through its own campus (rank 2), never as a global fallback.
             WHEN 'all' = ANY(ib.applies_to) AND ib.program_categories IS NULL
                  AND ib.slug NOT IN (
                    SELECT branding_slug FROM public.campuses WHERE branding_slug IS NOT NULL
                  )
                  THEN 5
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
   ORDER BY r.rank, r.is_default DESC, ib.id
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lead_branding(uuid, text) TO authenticated, service_role;
