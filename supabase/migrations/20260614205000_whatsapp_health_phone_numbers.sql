-- Include the human-readable business WhatsApp number in the per-sender
-- health payload. The UI should show +91 phone numbers in sender pickers,
-- while still storing/routing by Meta phone_number_id.

CREATE OR REPLACE FUNCTION public.fn_whatsapp_health_dashboard(
  p_days integer DEFAULT 14,
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_since      timestamptz;
  v_until      timestamptz;
  v_window     integer;
  v_overall    jsonb;
  v_templates  jsonb;
  v_phones     jsonb;
  v_errors     jsonb;
  v_daily      jsonb;
  v_recent     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorised' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'super_admin'::public.app_role) OR
    public.has_role(v_uid, 'admission_head'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden — super_admin or admission_head role required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_from IS NOT NULL THEN
    v_since := p_from;
    v_until := COALESCE(p_to, now());
    IF v_until <= v_since THEN
      RAISE EXCEPTION 'p_to must be greater than p_from'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_until - v_since > interval '366 days' THEN
      RAISE EXCEPTION 'Range too large (max 366 days)'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_window := GREATEST(1, ceil(extract(epoch FROM (v_until - v_since)) / 86400.0)::int);
  ELSE
    IF p_days IS NULL OR p_days <= 0 OR p_days > 90 THEN
      p_days := 14;
    END IF;
    v_until := now();
    v_since := v_until - (p_days || ' days')::interval;
    v_window := p_days;
  END IF;

  SELECT jsonb_build_object(
    'window_days',     v_window,
    'since',           v_since,
    'until',           v_until,
    'total',           count(*),
    'sent',            count(*) FILTER (WHERE status IN ('sent','delivered','read')),
    'delivered',       count(*) FILTER (WHERE status IN ('delivered','read')),
    'read',            count(*) FILTER (WHERE status = 'read'),
    'failed',          count(*) FILTER (WHERE status = 'failed'),
    'read_pct',        round(100.0 * count(*) FILTER (WHERE status='read')   / nullif(count(*),0), 1),
    'failed_pct',      round(100.0 * count(*) FILTER (WHERE status='failed') / nullif(count(*),0), 1),
    'distinct_phones', count(DISTINCT business_phone_number_id),
    'distinct_templates', count(DISTINCT template_key)
  )
  INTO v_overall
  FROM public.whatsapp_messages
  WHERE direction = 'outbound' AND created_at >= v_since AND created_at < v_until;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.failed_pct DESC NULLS LAST, t.total DESC), '[]'::jsonb)
  INTO v_templates
  FROM (
    SELECT
      COALESCE(template_key, '(none)') AS template_key,
      count(*)                                                    AS total,
      count(*) FILTER (WHERE status='read')                       AS read,
      count(*) FILTER (WHERE status='delivered')                  AS delivered,
      count(*) FILTER (WHERE status='sent')                       AS sent,
      count(*) FILTER (WHERE status='failed')                     AS failed,
      round(100.0 * count(*) FILTER (WHERE status='read')   / nullif(count(*),0), 1) AS read_pct,
      round(100.0 * count(*) FILTER (WHERE status='failed') / nullif(count(*),0), 1) AS failed_pct
    FROM public.whatsapp_messages
    WHERE direction = 'outbound' AND created_at >= v_since AND created_at < v_until
    GROUP BY 1
  ) t;

  SELECT COALESCE(jsonb_agg(p ORDER BY p.failed_pct DESC NULLS LAST, p.total DESC), '[]'::jsonb)
  INTO v_phones
  FROM (
    SELECT
      COALESCE(business_phone_number_id, '(unset)') AS phone_number_id,
      max(nullif(regexp_replace(COALESCE(business_phone_number, ''), '[^0-9]', '', 'g'), '')) AS business_phone_number,
      count(*)                                                    AS total,
      count(*) FILTER (WHERE status='failed')                     AS failed,
      count(*) FILTER (WHERE status='read')                       AS read,
      round(100.0 * count(*) FILTER (WHERE status='failed') / nullif(count(*),0), 1) AS failed_pct,
      round(100.0 * count(*) FILTER (WHERE status='read')   / nullif(count(*),0), 1) AS read_pct
    FROM public.whatsapp_messages
    WHERE direction = 'outbound' AND created_at >= v_since AND created_at < v_until
    GROUP BY 1
  ) p;

  SELECT COALESCE(jsonb_agg(e ORDER BY e.failures DESC), '[]'::jsonb)
  INTO v_errors
  FROM (
    SELECT
      status_error->'error'->>'code'    AS meta_code,
      status_error->'error'->>'message' AS meta_message,
      COALESCE(template_key, '(none)')  AS template_key,
      COALESCE(business_phone_number_id, '(unset)') AS phone_number_id,
      count(*) AS failures
    FROM public.whatsapp_messages
    WHERE direction = 'outbound'
      AND status = 'failed'
      AND status_error IS NOT NULL
      AND created_at >= v_since
      AND created_at < v_until
    GROUP BY 1,2,3,4
  ) e;

  SELECT COALESCE(jsonb_agg(d ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      to_char(date_trunc('day', created_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
      count(*) AS total,
      count(*) FILTER (WHERE status='read')   AS read,
      count(*) FILTER (WHERE status='failed') AS failed
    FROM public.whatsapp_messages
    WHERE direction = 'outbound' AND created_at >= v_since AND created_at < v_until
    GROUP BY 1
  ) d;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT
      created_at,
      template_key,
      business_phone_number_id AS phone_number_id,
      '****' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 4) AS phone_masked,
      status_error->'error'->>'code'    AS meta_code,
      status_error->'error'->>'message' AS meta_message,
      lead_id
    FROM public.whatsapp_messages
    WHERE direction = 'outbound' AND status = 'failed'
      AND created_at >= v_since AND created_at < v_until
    ORDER BY created_at DESC
    LIMIT 50
  ) r;

  RETURN jsonb_build_object(
    'overall',   v_overall,
    'templates', v_templates,
    'phones',    v_phones,
    'errors',    v_errors,
    'daily',     v_daily,
    'recent',    v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_whatsapp_health_dashboard(integer, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_whatsapp_health_dashboard(integer, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.fn_whatsapp_health_dashboard(integer, timestamptz, timestamptz) IS
  'WhatsApp Health dashboard aggregator. Per-number rows include business_phone_number for sender pickers. Restricted to super_admin / admission_head.';
