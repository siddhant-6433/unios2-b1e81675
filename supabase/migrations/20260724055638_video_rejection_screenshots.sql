-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260724055638 name=video_rejection_screenshots applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS rejection_screenshots text[];

COMMENT ON COLUMN public.videos.rejection_screenshots IS
  'Public URLs (application-documents bucket) of screenshots the reviewer attaches when sending a video back for correction.';
