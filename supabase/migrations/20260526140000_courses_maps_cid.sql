-- Per-course Google Maps Place CID. Used by whatsapp-send to override the
-- campus-level CID when a lead's course sits in a building with its own
-- separate Google Maps listing (e.g. Mirai vs. School of Education on the
-- Ghaziabad 2 campus). Resolution order in whatsapp-send:
--   1. caller-supplied button_urls
--   2. courses.maps_cid (looked up via lead.course_id)
--   3. campuses.maps_cid (looked up via lead.campus_id)
--   4. hard-coded default CID

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS maps_cid text;

COMMENT ON COLUMN public.courses.maps_cid IS
  'Optional Google Maps Place CID used as the visit_confirmation URL-button suffix for leads on this course. Takes precedence over campuses.maps_cid. Find it at maps.google.com/?cid=<CID> in the share URL.';
