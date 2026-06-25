-- Treat re-uploaded application documents as replacements for the same
-- logical document key when deciding whether rejected docs still block AN.
--
-- application_doc_reviews is keyed by storage file_path, so a rejected old
-- path can survive after the applicant uploads and staff verifies a
-- replacement path. The approval UI and payment trigger should consider the
-- latest review per logical doc key, not any historical rejected path.

CREATE OR REPLACE FUNCTION public.application_doc_key(_file_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH file_name AS (
    SELECT regexp_replace(coalesce(_file_path, ''), '^.*/', '') AS name
  )
  SELECT CASE
    WHEN name LIKE 'passport_photo.%' THEN 'passport_photo'
    WHEN position('-' in name) > 1 THEN left(name, position('-' in name) - 1)
    ELSE regexp_replace(name, '\.[^.]*$', '')
  END
  FROM file_name;
$$;

COMMENT ON FUNCTION public.application_doc_key(text) IS
  'Extracts the logical application document key from an application-documents storage path.';

CREATE OR REPLACE FUNCTION public.lead_has_rejected_doc(_lead_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked_reviews AS (
    SELECT
      r.status,
      row_number() OVER (
        PARTITION BY a.application_id, public.application_doc_key(r.file_path)
        ORDER BY coalesce(r.reviewed_at, r.updated_at, r.created_at) DESC, r.id DESC
      ) AS review_rank
    FROM public.applications a
    JOIN public.application_doc_reviews r
      ON r.application_id = a.application_id
    WHERE a.lead_id = _lead_id
      AND r.file_path IS NOT NULL
  )
  SELECT EXISTS (
    SELECT 1
    FROM ranked_reviews
    WHERE review_rank = 1
      AND status = 'rejected'
  );
$$;

GRANT EXECUTE ON FUNCTION public.application_doc_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_has_rejected_doc(uuid) TO authenticated, service_role;
