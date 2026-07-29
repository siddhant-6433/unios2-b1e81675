-- Reviewers can attach screenshots when sending a video back for correction,
-- so the editor sees exactly what needs fixing before resubmitting.
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS rejection_screenshots text[];

COMMENT ON COLUMN public.videos.rejection_screenshots IS
  'Public URLs (application-documents bucket) of screenshots the reviewer attaches when sending a video back for correction.';
