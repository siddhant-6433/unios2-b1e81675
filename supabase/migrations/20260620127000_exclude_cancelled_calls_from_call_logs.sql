-- Cancelled calls are not counsellor call attempts. They must not appear in
-- call_logs or any counsellor call metrics derived from call_logs.

DELETE FROM public.call_logs
WHERE disposition IN ('cancelled', 'cancelled_by_counsellor');

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

  SELECT id INTO v_id
    FROM public.call_logs
   WHERE cloud_call_uuid = p_call_uuid
   LIMIT 1;

  -- Cancellation is an operational hangup state, not a call outcome. If a row
  -- already exists for this UUID, preserve it; otherwise return NULL.
  IF p_disposition IN ('cancelled', 'cancelled_by_counsellor') THEN
    RETURN v_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.call_logs (
      lead_id, user_id, direction,
      duration_seconds, disposition, recording_url, notes,
      cloud_call_uuid, source, called_at
    ) VALUES (
      p_lead_id, p_user_id, 'outbound',
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
           source           = COALESCE(source, p_call_source)
     WHERE id = v_id;
  ELSE
    UPDATE public.call_logs
       SET duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0)),
           recording_url    = COALESCE(recording_url, p_recording_url),
           disposition      = COALESCE(disposition, p_disposition),
           notes            = COALESCE(notes, p_notes),
           user_id          = COALESCE(user_id, p_user_id),
           source           = COALESCE(source, p_call_source)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.call_log_metrics(
  p_from_date text DEFAULT NULL,
  p_to_date text DEFAULT NULL,
  p_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH params AS (
  SELECT
    CASE
      WHEN NULLIF(p_from_date, '') IS NULL THEN NULL
      ELSE (p_from_date || 'T00:00:00')::timestamptz
    END AS from_ts,
    CASE
      WHEN NULLIF(p_to_date, '') IS NULL THEN NULL
      ELSE (p_to_date || 'T23:59:59')::timestamptz
    END AS to_ts
),
scoped AS (
  SELECT cl.user_id, cl.disposition
  FROM public.call_logs cl
  CROSS JOIN params p
  WHERE (p.from_ts IS NULL OR cl.created_at >= p.from_ts)
    AND (p.to_ts IS NULL OR cl.created_at <= p.to_ts)
    AND (p_counsellor_id IS NULL OR cl.user_id = p_counsellor_id)
    AND (cl.disposition IS NULL OR cl.disposition NOT IN ('cancelled', 'cancelled_by_counsellor'))
),
totals AS (
  SELECT
    COUNT(*)::integer AS total,
    COUNT(*) FILTER (WHERE disposition = 'interested')::integer AS interested,
    COUNT(*) FILTER (WHERE disposition = 'not_interested')::integer AS not_interested,
    COUNT(*) FILTER (WHERE disposition IN ('not_answered', 'no_answer', 'voicemail'))::integer AS no_answer,
    COUNT(*) FILTER (WHERE disposition = 'busy')::integer AS busy,
    COUNT(*) FILTER (WHERE disposition IN ('call_back', 'callback'))::integer AS call_back
  FROM scoped
),
counsellor_rows AS (
  SELECT
    s.user_id,
    COALESCE(p.display_name, 'Unknown') AS name,
    COUNT(*)::integer AS calls
  FROM scoped s
  LEFT JOIN public.profiles p ON p.user_id = s.user_id
  WHERE s.user_id IS NOT NULL
  GROUP BY s.user_id, p.display_name
),
counsellors AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', user_id,
        'name', name,
        'count', calls
      )
      ORDER BY calls DESC, name
    ),
    '[]'::jsonb
  ) AS rows
  FROM counsellor_rows
)
SELECT jsonb_build_object(
  'total', totals.total,
  'interested', totals.interested,
  'not_interested', totals.not_interested,
  'no_answer', totals.no_answer,
  'busy', totals.busy,
  'call_back', totals.call_back,
  'counsellors', counsellors.rows
)
FROM totals
CROSS JOIN counsellors;
$$;

GRANT EXECUTE ON FUNCTION public.call_log_metrics(text, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
