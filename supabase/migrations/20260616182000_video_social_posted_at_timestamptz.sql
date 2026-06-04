-- =====================================================
-- Video social posting timestamps: date -> timestamptz
-- =====================================================
-- Editors record when a video went live on each platform. The original
-- columns were `date`, but the posting time of day matters (e.g. for
-- same-day scheduling / audit), so widen them to timestamptz. Existing
-- date values cast cleanly to midnight in the session timezone.
--
-- Only the type changes. The videos_before_change trigger derives
-- posted_month via GREATEST(...) + date_trunc('month', ...)::date, both of
-- which accept timestamptz unchanged, so no trigger rewrite is needed.
-- posted_month itself stays `date`, so VideoBills aggregation is unaffected.

ALTER TABLE public.videos
  ALTER COLUMN instagram_posted_on TYPE timestamptz USING instagram_posted_on::timestamptz,
  ALTER COLUMN linkedin_posted_on  TYPE timestamptz USING linkedin_posted_on::timestamptz,
  ALTER COLUMN youtube_posted_on   TYPE timestamptz USING youtube_posted_on::timestamptz;
