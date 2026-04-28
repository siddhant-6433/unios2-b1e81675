-- Support multiple face images per registration
ALTER TABLE employee_face_registrations
  ADD COLUMN IF NOT EXISTS image_urls text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS registration_type text DEFAULT 'single';

-- Migrate existing single images to the array
UPDATE employee_face_registrations
SET image_urls = ARRAY[image_url]
WHERE image_url IS NOT NULL AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);
