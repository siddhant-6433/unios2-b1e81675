-- Spam diagnostic dashboard RPC.
--
-- Returns a single jsonb with everything the WhatsApp Health admin page
-- needs to triage Meta spam markings: overall counts, per-template health,
-- per-business-phone-number health, Meta error-code breakdown, daily series,
-- and the most recent failures with status_error detail.
--
-- All numbers are scoped to the last p_days days (default 14).
-- Restricted to super_admin and admission_head via has_role checks.

CREATE OR REPLACE FUNCTION public.fn_whatsapp_health_dashboard(p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_since      timestamptz;
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

  IF p_days IS NULL OR p_days <= 0 OR p_days > 90 THEN
    p_days := 14;
  END IF;

  v_since := now() - (p_days || ' days')::interval;

  -- Overall counts across the window.
  SELECT jsonb_build_object(
    'window_days',     p_days,
    'since',           v_since,
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
  WHERE direction = 'outbound' AND created_at >= v_since;

  -- Per-template health, ordered by failure rate then volume.
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
    WHERE direction = 'outbound' AND created_at >= v_since
    GROUP BY 1
  ) t;

  -- Per-business-phone-number health. Helps isolate which Meta number is
  -- under quality-rating penalty.
  SELECT COALESCE(jsonb_agg(p ORDER BY p.failed_pct DESC NULLS LAST, p.total DESC), '[]'::jsonb)
  INTO v_phones
  FROM (
    SELECT
      COALESCE(business_phone_number_id, '(unset)') AS phone_number_id,
      count(*)                                                    AS total,
      count(*) FILTER (WHERE status='failed')                     AS failed,
      count(*) FILTER (WHERE status='read')                       AS read,
      round(100.0 * count(*) FILTER (WHERE status='failed') / nullif(count(*),0), 1) AS failed_pct,
      round(100.0 * count(*) FILTER (WHERE status='read')   / nullif(count(*),0), 1) AS read_pct
    FROM public.whatsapp_messages
    WHERE direction = 'outbound' AND created_at >= v_since
    GROUP BY 1
  ) p;

  -- Meta error-code breakdown. status_error is jsonb populated by both
  -- whatsapp-send and the webhook status callback. Codes worth watching:
  --   131048 = spam-rate limit hit (smoking gun)
  --   131049 = 24h window expired (proxy for user blocking)
  --   131026 = undeliverable (often quality throttle)
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
    GROUP BY 1,2,3,4
  ) e;

  -- Daily series for sparkline.
  SELECT COALESCE(jsonb_agg(d ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      to_char(date_trunc('day', created_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
      count(*) AS total,
      count(*) FILTER (WHERE status='read')   AS read,
      count(*) FILTER (WHERE status='failed') AS failed
    FROM public.whatsapp_messages
    WHERE direction = 'outbound' AND created_at >= v_since
    GROUP BY 1
  ) d;

  -- Recent failures with phone masked (last 4 only) for spot-check triage.
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
      AND created_at >= v_since
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

REVOKE ALL ON FUNCTION public.fn_whatsapp_health_dashboard(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_whatsapp_health_dashboard(integer) TO authenticated;

COMMENT ON FUNCTION public.fn_whatsapp_health_dashboard(integer) IS
  'Aggregates whatsapp_messages over the last N days into a single jsonb for the spam diagnostic dashboard. Restricted to super_admin / admission_head. Returns: overall, templates[], phones[], errors[], daily[], recent[].';
