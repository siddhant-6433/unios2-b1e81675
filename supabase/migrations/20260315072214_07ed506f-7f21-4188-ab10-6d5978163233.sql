CREATE POLICY "Anyone can update application docs"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (bucket_id = 'application-documents')
WITH CHECK (bucket_id = 'application-documents');