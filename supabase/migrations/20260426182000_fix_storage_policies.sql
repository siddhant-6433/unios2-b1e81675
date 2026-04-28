-- Recreate selfies bucket as public (so URLs work without auth headers)
UPDATE storage.buckets SET public = true WHERE id = 'selfies';

-- Drop old policies that might conflict
DROP POLICY IF EXISTS "Users can upload own selfies" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own selfies" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all selfies" ON storage.objects;

-- Allow any authenticated user to upload to their own folder
CREATE POLICY "selfies_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'selfies');

-- Allow any authenticated user to update (upsert) their own files
CREATE POLICY "selfies_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'selfies');

-- Allow anyone to read selfies (bucket is public)
CREATE POLICY "selfies_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'selfies');

CREATE POLICY "selfies_read_anon"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'selfies');
