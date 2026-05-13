-- Fix: logCallDisposition in LeadDetail passes crypto.randomUUID() so the
-- UUID lookup always misses and a duplicate row is inserted alongside the
-- existing Cloud Call row. When p_source='manual' and no UUID match is found,
-- fall back to the most recent pending Cloud Call row for that lead (within
-- 4 hours) and update it instead of inserting a second row.

CREATE OR REPLACE FUNCTION public.record_cloud_call_log(
  p_call_uuid       text,
  p_lead_id         uuid,
  p_user_id         uuid,
  p_disposition     text,
  p_duration        integer,
  p_notes           text,
  p_source          text,
  p_recording_url   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_call_uuid IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_call_uuid and p_lead_id are required';
  END IF;
  IF p_source NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'p_source must be ''auto'' or ''manual''';
  END IF;

  -- Primary dedup: match by UUID
  SELECT id INTO v_id
    FROM public.call_logs
   WHERE cloud_call_uuid = p_call_uuid
   LIMIT 1;

  -- Secondary dedup for manual disposition from lead page:
  -- if UUID didn't match (fresh randomUUID), look for the most recent
  -- pending Cloud Call row for this lead within the last 4 hours.
  IF v_id IS NULL AND p_source = 'manual' THEN
    SELECT id INTO v_id
      FROM public.call_logs
     WHERE lead_id    = p_lead_id
       AND disposition = 'pending'
       AND created_at  > now() - interval '4 hours'
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.call_logs (
      lead_id, user_id, direction,
      duration_seconds, disposition, recording_url, notes,
      cloud_call_uuid, called_at
    ) VALUES (
      p_lead_id, p_user_id, 'outbound',
      COALESCE(p_duration, 0), p_disposition, p_recording_url, p_notes,
      p_call_uuid, now()
    ) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF p_source = 'manual' THEN
    UPDATE public.call_logs
       SET disposition      = COALESCE(p_disposition, disposition),
           notes            = COALESCE(NULLIF(p_notes, ''), notes),
           user_id          = COALESCE(user_id, p_user_id),
           duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0))
     WHERE id = v_id;
  ELSE
    UPDATE public.call_logs
       SET duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0)),
           recording_url    = COALESCE(recording_url, p_recording_url),
           disposition      = COALESCE(disposition, p_disposition),
           notes            = COALESCE(notes, p_notes),
           user_id          = COALESCE(user_id, p_user_id)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text) TO service_role;
