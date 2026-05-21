-- Tighten storage.objects policies for the three public buckets the advisor
-- flagged: application-documents, course-documents, selfies.
--
-- All three buckets have `public=true`, which means signed-URL access works
-- without an RLS check. The broad SELECT policies on storage.objects only
-- enable the LIST endpoint — clients could enumerate every file in each
-- bucket. Public buckets don't need listing for normal usage; drop those
-- policies to remove the enumeration vector.
--
-- The matching open UPDATE policies ('Anyone can update application docs',
-- 'Auth update course-documents' which actually included {anon}) let any
-- caller overwrite any file in the bucket. Replace with authenticated-only
-- UPDATE so an arbitrary client can't substitute someone else's application
-- document or course PDF.

-- application-documents
DROP POLICY IF EXISTS "Anyone can view application docs"   ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update application docs" ON storage.objects;

CREATE POLICY "Auth update application-documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'application-documents')
  WITH CHECK (bucket_id = 'application-documents');

-- course-documents
DROP POLICY IF EXISTS "Public read course-documents"  ON storage.objects;
DROP POLICY IF EXISTS "Auth update course-documents"  ON storage.objects;

CREATE POLICY "Auth update course-documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'course-documents')
  WITH CHECK (bucket_id = 'course-documents');

-- selfies
DROP POLICY IF EXISTS "selfies_select_anon" ON storage.objects;
DROP POLICY IF EXISTS "selfies_select_auth" ON storage.objects;
-- selfies_insert_auth and selfies_update_auth remain unchanged.
