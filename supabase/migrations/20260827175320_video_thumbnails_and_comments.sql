-- =====================================================
-- Video: mandatory thumbnails + two-way revision comments
-- =====================================================
-- 1. Two thumbnail URLs per video (16:9 for YouTube, 9:16 for Instagram),
--    filled at submission time. Nullable on purpose — "mandatory" is enforced
--    client-side; a NOT NULL would break updates of legacy rows that have none.
-- 2. author_name on the event log so a comment shows who wrote it.
-- 3. add_video_comment RPC so editors + reviewers can post free-form comments
--    into the append-only video_events timeline (video_events stays
--    INSERT-only via SECURITY DEFINER; users never insert directly).

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS thumbnail_youtube_url   text,  -- 16:9
  ADD COLUMN IF NOT EXISTS thumbnail_instagram_url text;  -- 9:16

ALTER TABLE public.video_events
  ADD COLUMN IF NOT EXISTS author_name text;

-- Free-form comment on a video. Any super admin, or the editor who owns the
-- video, may comment at any time. Logged as a 'comment' event so it threads
-- into the existing History timeline.
CREATE OR REPLACE FUNCTION public.add_video_comment(
  p_video_id uuid,
  p_note text,
  p_screenshots text[] DEFAULT NULL
) RETURNS public.video_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_super boolean := public.has_role(auth.uid(), 'super_admin'::app_role);
  v_owns boolean;
  v_author text;
  v_event public.video_events;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'Comment cannot be empty';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.videos v
    JOIN public.video_editors e ON e.id = v.editor_id
    WHERE v.id = p_video_id AND e.user_id = auth.uid()
  ) INTO v_owns;

  IF NOT v_is_super AND NOT v_owns THEN
    RAISE EXCEPTION 'Not allowed to comment on this video';
  END IF;

  -- Prefer a real display name; fall back to the editor's name, then a generic.
  SELECT display_name INTO v_author FROM public.profiles WHERE user_id = auth.uid();
  IF v_author IS NULL OR btrim(v_author) = '' THEN
    SELECT name INTO v_author FROM public.video_editors WHERE user_id = auth.uid() LIMIT 1;
  END IF;
  IF v_author IS NULL OR btrim(v_author) = '' THEN
    v_author := 'User';
  END IF;

  INSERT INTO public.video_events (video_id, event, note, screenshots, actor, author_name)
  VALUES (p_video_id, 'comment', btrim(p_note), p_screenshots, auth.uid(), v_author)
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_video_comment(uuid, text, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_video_comment(uuid, text, text[]) TO authenticated;
