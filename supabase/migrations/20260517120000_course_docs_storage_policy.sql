-- Allow anyone to read course documents (public bucket)
CREATE POLICY "Public read course-documents" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'course-documents');

-- Allow authenticated users to upload course documents
CREATE POLICY "Auth upload course-documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'course-documents');

-- Allow anon upload for CLI/migration uploads
CREATE POLICY "Anon upload course-documents" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'course-documents');

CREATE POLICY "Auth update course-documents" ON storage.objects
  FOR UPDATE TO authenticated, anon
  USING (bucket_id = 'course-documents');
