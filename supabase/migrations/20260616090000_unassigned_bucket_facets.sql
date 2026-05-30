-- Accurate course/source facet counts for the unassigned-leads bucket.
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
-- `web_chat` and `website_chat` are coalesced into a single `web_chat` source
-- key to match the bucket header chips and the client-side source filter.

CREATE OR REPLACE FUNCTION public.unassigned_bucket_facets(
  _bucket text DEFAULT NULL,
  _school_brand text DEFAULT NULL
)
RETURNS TABLE (facet text, value text, n bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT course_name, source
    FROM public.get_unassigned_leads_bucket()
    WHERE (_bucket IS NULL OR bucket = _bucket)
      AND (_school_brand IS NULL OR school_brand = _school_brand)
  )
  SELECT 'course'::text AS facet, course_name AS value, count(*) AS n
  FROM scoped
  WHERE course_name IS NOT NULL AND btrim(course_name) NOT IN ('', '—')
  GROUP BY course_name
  UNION ALL
  SELECT 'source'::text AS facet,
         CASE WHEN source IN ('web_chat', 'website_chat') THEN 'web_chat'
              ELSE source END AS value,
         count(*) AS n
  FROM scoped
  WHERE source IS NOT NULL AND btrim(source) <> ''
  GROUP BY 2;
$$;

GRANT EXECUTE ON FUNCTION public.unassigned_bucket_facets(text, text) TO authenticated;
