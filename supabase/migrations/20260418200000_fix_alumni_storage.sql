-- Fix: allow authenticated users to upload to alumni-verification-docs bucket
CREATE POLICY "Auth upload alumni docs" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'alumni-verification-docs');

-- Allow authenticated to update (upsert)
CREATE POLICY "Auth update alumni docs" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'alumni-verification-docs');

-- Allow anon to update (upsert)
CREATE POLICY "Anon update alumni docs" ON storage.objects
  FOR UPDATE TO anon USING (bucket_id = 'alumni-verification-docs');
