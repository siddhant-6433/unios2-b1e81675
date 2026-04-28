-- Drop ALL existing selfies policies and recreate simply
DROP POLICY IF EXISTS "selfies_upload" ON storage.objects;
DROP POLICY IF EXISTS "selfies_update" ON storage.objects;
DROP POLICY IF EXISTS "selfies_read" ON storage.objects;
DROP POLICY IF EXISTS "selfies_read_anon" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own selfies" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own selfies" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all selfies" ON storage.objects;

-- Simple policies: any authenticated user can upload and read from selfies bucket
CREATE POLICY "selfies_insert_auth"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'selfies');

CREATE POLICY "selfies_update_auth"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'selfies')
  WITH CHECK (bucket_id = 'selfies');

CREATE POLICY "selfies_select_auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'selfies');

CREATE POLICY "selfies_select_anon"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'selfies');

-- Ensure bucket is public for URL access
UPDATE storage.buckets SET public = true WHERE id = 'selfies';
