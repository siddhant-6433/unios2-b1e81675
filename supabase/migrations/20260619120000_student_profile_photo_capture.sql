-- Store AI-processed student profile photos captured by staff.
-- Writes go through the student-profile-photo-upload Edge Function so branch
-- access can be enforced before the service role updates students.photo_url.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-profile-photos',
  'student-profile-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Authenticated users can view student profile photos" ON storage.objects;
CREATE POLICY "Authenticated users can view student profile photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'student-profile-photos');
