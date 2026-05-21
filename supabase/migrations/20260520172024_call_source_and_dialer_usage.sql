-- Phase 4 (non-enforcing): track which calls came from the Cloud Dialer vs
-- a counsellor-typed manual log, and expose per-counsellor usage % so managers
-- can see adoption.
--
-- Today `record_cloud_call_log` is used by both the Cloud Dialer queue AND
-- the "log a call from the lead page" flow — there's no way to tell which
-- channel a row came from. We fix that here without disturbing the existing
-- dedup behaviour (the `p_source` param keeps its current 'auto'/'manual'
-- meaning for webhook-vs-disposition; the NEW `p_call_source` param is
-- orthogonal: cloud_dialer / manual_log / inbound).

-- 1. New column. Nullable on purpose — historical rows have unknown channel
--    and should be excluded from the usage denominator (we don't penalize
--    counsellors retroactively for calls logged before we could measure).
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.call_logs.source IS
  'Channel the call was placed/logged from. Values: cloud_dialer, manual_log, inbound. NULL for historical rows that pre-date this column — excluded from usage % so counsellors are not penalised retroactively.';

CREATE INDEX IF NOT EXISTS idx_call_logs_source_user
  ON public.call_logs (user_id, source, called_at);

-- 2. Extend record_cloud_call_log to accept the new channel.
--    Signature change is additive: existing callers that don't pass p_call_source
--    keep working (column stays NULL for those rows until they're updated).
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
           -- Channel is first-write-wins: an auto webhook may not have known
           -- the channel (it never does), so a later manual save with a known
           -- channel populates it. Don't overwrite a non-null channel.
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

-- 3. Per-counsellor per-week dialer-usage view.
--    Excludes rows where source IS NULL (legacy unknowns) from BOTH numerator
--    and denominator — usage % only reflects calls we can attribute.
--    Aggregates over the current ISO week in IST.
CREATE OR REPLACE VIEW public.counsellor_dialer_usage AS
SELECT
  p.id                                                                       AS counsellor_id,
  p.display_name                                                             AS counsellor_name,
  (date_trunc('week', (cl.called_at AT TIME ZONE 'Asia/Kolkata')))::date     AS week_start,
  COUNT(*) FILTER (WHERE cl.source = 'cloud_dialer')                         AS cloud_dialer_calls,
  COUNT(*) FILTER (WHERE cl.source = 'manual_log')                           AS manual_log_calls,
  COUNT(*) FILTER (WHERE cl.source = 'inbound')                              AS inbound_calls,
  COUNT(*) FILTER (WHERE cl.source IS NOT NULL)                              AS attributed_calls,
  CASE
    WHEN COUNT(*) FILTER (WHERE cl.source IN ('cloud_dialer','manual_log')) = 0 THEN NULL
    ELSE ROUND(
      100.0 * COUNT(*) FILTER (WHERE cl.source = 'cloud_dialer')
            / NULLIF(COUNT(*) FILTER (WHERE cl.source IN ('cloud_dialer','manual_log')), 0),
      1
    )
  END                                                                        AS dialer_usage_pct
FROM public.call_logs cl
JOIN public.profiles p ON p.user_id = cl.user_id
WHERE cl.source IS NOT NULL
GROUP BY p.id, p.display_name, week_start;

GRANT SELECT ON public.counsellor_dialer_usage TO authenticated;

COMMENT ON VIEW public.counsellor_dialer_usage IS
  'Per-counsellor per-week Cloud Dialer adoption. dialer_usage_pct denominator is cloud_dialer + manual_log calls only — inbound and unattributed (legacy) calls are excluded so the metric reflects channel choice, not call volume.';
