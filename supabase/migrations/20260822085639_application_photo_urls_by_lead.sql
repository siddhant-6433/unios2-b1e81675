-- application photo urls by lead
--
-- Bulk-resolves the applicant photo for a set of leads in one round-trip, so the
-- Students list / profile fallback no longer fires a list-app-docs edge call per
-- lead (was ~17 batches for ~130 photo_url-null students). SECURITY DEFINER so it
-- works for teacher/faculty too — they can see the students list but application_documents
-- RLS excludes them. Photos are public URLs, so returning them by lead is not a
-- data-sensitivity change. Leads without a photo row here (storage-only older uploads)
-- are simply absent and the caller falls back to the edge function for those.

CREATE OR REPLACE FUNCTION public.application_photo_urls_by_lead(_lead_ids uuid[])
RETURNS TABLE(lead_id uuid, url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (a.lead_id) a.lead_id, ad.file_url
  FROM applications a
  JOIN application_documents ad ON ad.application_id = a.application_id
  WHERE a.lead_id = ANY(_lead_ids)
    AND ad.doc_key ~* 'photo'
    AND ad.file_url IS NOT NULL
  ORDER BY a.lead_id, ad.uploaded_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.application_photo_urls_by_lead(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.application_photo_urls_by_lead(uuid[]) TO authenticated;
