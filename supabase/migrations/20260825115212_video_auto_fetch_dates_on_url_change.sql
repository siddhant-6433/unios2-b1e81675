-- Auto-fetch platform posting dates when a video's URLs change.
-- Fires pg_net → video-fetch-post-dates edge function with { video_id }.
-- The edge function fetches dates from Instagram/YouTube APIs and decodes
-- LinkedIn's activity-id timestamp, then the existing videos_before_change
-- trigger recomputes posted_month.

CREATE OR REPLACE FUNCTION public.fn_video_auto_fetch_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Only fire when a platform URL actually changed (or was set for the first time).
  IF TG_OP = 'UPDATE'
     AND NEW.instagram_url IS NOT DISTINCT FROM OLD.instagram_url
     AND NEW.linkedin_url  IS NOT DISTINCT FROM OLD.linkedin_url
     AND NEW.youtube_url   IS NOT DISTINCT FROM OLD.youtube_url
  THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'fn_video_auto_fetch_dates: _app_config missing supabase_url or service_role_key';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/video-fetch-post-dates',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('video_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Auto-fetch dates failed for video %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_video_auto_fetch_dates ON public.videos;
CREATE TRIGGER trg_video_auto_fetch_dates
  AFTER INSERT OR UPDATE OF instagram_url, linkedin_url, youtube_url
  ON public.videos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_video_auto_fetch_dates();
