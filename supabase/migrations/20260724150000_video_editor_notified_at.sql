-- Track when the editor was last pinged on WhatsApp about a video (approval or
-- correction). Lets the reviewer UI show a "Editor notified" badge instead of
-- guessing whether the ping went out. Set by the video-notify edge function on
-- a successful send; cleared on resubmit so a re-review starts fresh.
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS editor_notified_at timestamptz;

COMMENT ON COLUMN public.videos.editor_notified_at IS
  'When video-notify last successfully WhatsApp-pinged the editor (approved/correction). Cleared on resubmit.';
