-- Inbound calls that are dispositioned from Lead Detail use the same
-- cloud-call dedupe RPC as outbound Cloud Dialer calls. Preserve their
-- direction so call logs and counsellor metrics do not count them as outbound.

CREATE OR REPLACE FUNCTION public.record_cloud_call_log(
  p_call_uuid       text,
  p_lead_id         uuid,
  p_user_id         uuid,
  p_disposition     text,
  p_duration        integer,
  p_notes           text,
  p_source          text,
  p_recording_url   text DEFAULT NULL,
  p_call_source     text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_direction text;
BEGIN
  IF p_call_uuid IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_call_uuid and p_lead_id are required';
  END IF;
  IF p_source NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'p_source must be ''auto'' or ''manual''';
  END IF;
  IF p_call_source IS NOT NULL AND p_call_source NOT IN ('cloud_dialer', 'manual_log', 'inbound') THEN
    RAISE EXCEPTION 'p_call_source must be NULL, ''cloud_dialer'', ''manual_log'', or ''inbound''';
  END IF;

  v_direction := CASE WHEN p_call_source = 'inbound' THEN 'inbound' ELSE 'outbound' END;

  SELECT id INTO v_id
    FROM public.call_logs
   WHERE cloud_call_uuid = p_call_uuid
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.call_logs (
      lead_id, user_id, direction,
      duration_seconds, disposition, recording_url, notes,
      cloud_call_uuid, source, called_at
    ) VALUES (
      p_lead_id, p_user_id, v_direction,
      COALESCE(p_duration, 0), p_disposition, p_recording_url, p_notes,
      p_call_uuid, p_call_source, now()
    ) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF p_source = 'manual' THEN
    UPDATE public.call_logs
       SET disposition      = COALESCE(p_disposition, disposition),
           notes            = COALESCE(NULLIF(p_notes, ''), notes),
           user_id          = COALESCE(user_id, p_user_id),
           duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0)),
           direction        = CASE WHEN p_call_source = 'inbound' THEN 'inbound' ELSE direction END,
           source           = COALESCE(source, p_call_source)
     WHERE id = v_id;
  ELSE
    UPDATE public.call_logs
       SET duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0)),
           recording_url    = COALESCE(recording_url, p_recording_url),
           disposition      = COALESCE(disposition, p_disposition),
           notes            = COALESCE(notes, p_notes),
           user_id          = COALESCE(user_id, p_user_id),
           direction        = CASE WHEN p_call_source = 'inbound' THEN 'inbound' ELSE direction END,
           source           = COALESCE(source, p_call_source)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text, text) TO service_role;
