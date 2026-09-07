-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260818125745 name=video_events_history applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.video_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  event text NOT NULL,
  note text,
  screenshots text[],
  actor uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_events_video ON public.video_events(video_id, created_at);

CREATE OR REPLACE FUNCTION public.videos_log_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'submitted';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_event := CASE
      WHEN NEW.status = 'rejected' THEN 'correction_requested'
      WHEN NEW.status = 'approved' THEN 'approved'
      WHEN NEW.status = 'published' THEN 'published'
      WHEN NEW.status = 'pending_approval' AND OLD.status = 'rejected' THEN 'resubmitted'
      WHEN NEW.status = 'pending_approval' THEN 'revoked'
      ELSE NULL
    END;
  END IF;

  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.video_events (video_id, event, note, screenshots, actor)
  VALUES (
    NEW.id,
    v_event,
    CASE WHEN v_event = 'correction_requested' THEN NEW.rejection_reason END,
    CASE WHEN v_event = 'correction_requested' THEN NEW.rejection_screenshots END,
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_videos_log_event ON public.videos;
CREATE TRIGGER trg_videos_log_event AFTER INSERT OR UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.videos_log_event();

ALTER TABLE public.video_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_events_super_admin ON public.video_events;
CREATE POLICY video_events_super_admin ON public.video_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS video_events_editor_read ON public.video_events;
CREATE POLICY video_events_editor_read ON public.video_events FOR SELECT TO authenticated
  USING (video_id IN (
    SELECT v.id FROM public.videos v
    JOIN public.video_editors e ON e.id = v.editor_id
    WHERE e.user_id = auth.uid()
  ));

GRANT SELECT ON public.video_events TO authenticated;
GRANT ALL    ON public.video_events TO service_role;
REVOKE EXECUTE ON FUNCTION public.videos_log_event() FROM PUBLIC, anon, authenticated;

INSERT INTO public.video_events (video_id, event, created_at)
SELECT id, 'submitted', created_at FROM public.videos
ON CONFLICT DO NOTHING;

INSERT INTO public.video_events (video_id, event, note, screenshots, actor, created_at)
SELECT id, 'correction_requested', rejection_reason, rejection_screenshots, approved_by,
       COALESCE(approved_at, updated_at)
FROM public.videos
WHERE status = 'rejected';

INSERT INTO public.video_events (video_id, event, actor, created_at)
SELECT id, 'approved', approved_by, approved_at
FROM public.videos
WHERE status IN ('approved','published') AND approved_at IS NOT NULL;
