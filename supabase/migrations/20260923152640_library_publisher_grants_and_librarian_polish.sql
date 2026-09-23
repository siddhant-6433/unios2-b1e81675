-- keep-migration-version: already applied and recorded on production schema_migrations
-- Applied as version 20260923152640; git must keep this timestamp for `db push`.
--
-- Bugs found while driving the Library UI as the librarian:
--
-- 1. library_publishers and library_branch_institutions were created with RLS
--    policies but never GRANTed to `authenticated`, so PostgREST returned 403.
--    library_list_publishers / library_publisher_duplicate_pairs are SECURITY
--    INVOKER, so they 403'd too (the Publishers entity list was silently empty).
-- 2. The librarian role was seeded with library:manage_settings, but the server
--    only grants manage_settings via an explicit manager assignment. The sidebar
--    therefore showed Settings/Access Matrix links that landed on a fallback tab.
-- 3. library_publisher_records called library_canonical_publisher() per row over
--    8,207 records; the drill-down hung on "Loading books…". Match the stored
--    value (already canonicalised by the backfill) directly instead.

-- 1. Restore table grants (RLS still governs rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_publishers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_branch_institutions TO authenticated;
GRANT ALL ON public.library_publishers TO service_role;
GRANT ALL ON public.library_branch_institutions TO service_role;

-- 2. A plain librarian does not manage settings; managers get it via assignment.
DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND rp.role = 'librarian'::public.app_role
  AND p.module = 'library'
  AND p.action = 'manage_settings';

-- 3. Fast drill-down: exact match on the (canonicalised) stored value.
CREATE OR REPLACE FUNCTION public.library_publisher_records(
  _publisher text,
  _limit int DEFAULT 300
)
RETURNS TABLE(
  source text,
  accession_no text,
  title text,
  branch_name text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH key AS (
    SELECT btrim(_publisher) AS v,
           public.library_canonical_publisher(_publisher) AS c
  )
  SELECT 'digitization'::text AS source,
         d.accession_no,
         d.title,
         b.name AS branch_name,
         d.status::text AS status
  FROM public.library_digitization_records d
  LEFT JOIN public.library_branches b ON b.id = d.branch_id
  CROSS JOIN key k
  WHERE public.can_operate_library()
    AND d.publisher IS NOT NULL
    AND (d.publisher = k.v OR (k.c IS NOT NULL AND d.publisher = k.c))
  UNION ALL
  SELECT 'catalog'::text,
         i.accession_no,
         bk.title,
         b.name,
         i.status::text
  FROM public.library_items i
  JOIN public.library_books bk ON bk.id = i.book_id
  LEFT JOIN public.library_branches b ON b.id = i.branch_id
  CROSS JOIN key k
  WHERE public.can_operate_library()
    AND bk.publisher IS NOT NULL
    AND (bk.publisher = k.v OR (k.c IS NOT NULL AND bk.publisher = k.c))
  ORDER BY accession_no NULLS LAST
  LIMIT greatest(_limit, 1);
$$;

CREATE INDEX IF NOT EXISTS idx_library_digitization_records_publisher
  ON public.library_digitization_records (publisher);
CREATE INDEX IF NOT EXISTS idx_library_books_publisher_text
  ON public.library_books (publisher);

NOTIFY pgrst, 'reload schema';
