-- Accurate, LINKED course/source facet counts for the unassigned-leads bucket.
--
-- The Lead Buckets page used to fetch up to 1000 rows (PostgREST's default
-- cap) and aggregate the course/source filter dropdowns client-side from that
-- sample. With 2900+ college leads the dropdowns showed "(1000)" and silently
-- dropped any course/source whose rows fell past the first page.
--
-- The page now lazy-loads 100 rows at a time, so client-side aggregation would
-- undercount even harder. This function returns TRUE per-course and per-source
-- counts for a bucket in one round trip, independent of pagination. It reuses
-- the existing SECURITY DEFINER bucket function so the WHERE clause (terminal
-- stages, mirrors, person_role, RLS surface) stays in exactly one place.
--
-- The dropdowns are LINKED (see src/lib/leadBucketFilters.ts): course options
-- are scoped to the active source filter and source options to the active
-- course filter. This prevents impossible combinations — Meta Ads lead-form
-- leads carry no course, so an unscoped course list let you pick "Meta Ads +
-- any course" and always get an empty result. `_source` / `_course` carry the
-- active filters; 'all' or NULL means "no scope".
--
-- The `course_all` / `source_all` rows are the header counts for the "All
-- courses" / "All sources" options — the total leads matching the OTHER active
-- filter (so the headers stay honest, e.g. "All courses (21)" under Meta Ads).
--
-- `web_chat` and `website_chat` are coalesced into a single `web_chat` source
-- key to match the bucket header chips and the client-side source filter.

CREATE OR REPLACE FUNCTION public.unassigned_bucket_facets(
  _bucket text DEFAULT NULL,
  _school_brand text DEFAULT NULL,
  _source text DEFAULT NULL,
  _course text DEFAULT NULL
)
RETURNS TABLE (facet text, value text, n bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      course_name,
      CASE WHEN source IN ('web_chat', 'website_chat') THEN 'web_chat'
           ELSE source END AS source_key
    FROM public.get_unassigned_leads_bucket()
    WHERE (_bucket IS NULL OR bucket = _bucket)
      AND (_school_brand IS NULL OR school_brand = _school_brand)
  ),
  -- Rows matching the active source filter → drive the course dropdown.
  by_source AS (
    SELECT * FROM scoped
    WHERE _source IS NULL OR _source = 'all' OR source_key = _source
  ),
  -- Rows matching the active course filter → drive the source dropdown.
  by_course AS (
    SELECT * FROM scoped
    WHERE _course IS NULL OR _course = 'all' OR course_name = _course
  )
  SELECT 'course'::text AS facet, course_name AS value, count(*)::bigint AS n
  FROM by_source
  WHERE course_name IS NOT NULL AND btrim(course_name) NOT IN ('', '—')
  GROUP BY course_name
  UNION ALL
  SELECT 'source'::text AS facet, source_key AS value, count(*)::bigint AS n
  FROM by_course
  WHERE source_key IS NOT NULL AND btrim(source_key) <> ''
  GROUP BY source_key
  UNION ALL
  SELECT 'course_all'::text AS facet, NULL::text AS value, count(*)::bigint AS n
  FROM by_source
  UNION ALL
  SELECT 'source_all'::text AS facet, NULL::text AS value, count(*)::bigint AS n
  FROM by_course;
$$;

GRANT EXECUTE ON FUNCTION public.unassigned_bucket_facets(text, text, text, text) TO authenticated;
