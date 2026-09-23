-- keep-migration-version: already applied and recorded on production schema_migrations
-- Applied as version 20260923142236; git must keep this timestamp for `db push`.
--
-- Which books carry a given publisher string (raw or canonical)?
--
-- The consolidation screen showed a name and a row count but not the actual
-- copies, so a librarian could not check the physical books to decide the correct
-- publisher. This returns the accession number + title (+ library + status) for
-- every staged record and catalogued copy matching the name.
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
    AND (
      d.publisher = k.v
      OR public.library_canonical_publisher(d.publisher) = k.v
      OR (k.c IS NOT NULL AND public.library_canonical_publisher(d.publisher) = k.c)
    )
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
    AND (
      bk.publisher = k.v
      OR public.library_canonical_publisher(bk.publisher) = k.v
      OR (k.c IS NOT NULL AND public.library_canonical_publisher(bk.publisher) = k.c)
    )
  ORDER BY accession_no NULLS LAST
  LIMIT greatest(_limit, 1);
$$;

REVOKE EXECUTE ON FUNCTION public.library_publisher_records(text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.library_publisher_records(text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.library_publisher_records(text, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
