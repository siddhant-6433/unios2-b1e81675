-- whatsapp meta delivery block alerts
-- Track recurring sender-wide Meta delivery blocks so the scheduled
-- whatsapp-route-health monitor can notify admins without flooding inboxes.
CREATE TABLE IF NOT EXISTS public.whatsapp_meta_delivery_alert_state (
  phone_number_id text NOT NULL,
  error_code text NOT NULL,
  first_alerted_at timestamptz NOT NULL DEFAULT now(),
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_failure_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (phone_number_id, error_code)
);
ALTER TABLE public.whatsapp_meta_delivery_alert_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.whatsapp_meta_delivery_alert_state TO service_role;
-- These codes indicate a sender/account configuration problem or sender-level
-- block, rather than a failure isolated to one recipient/template parameter.
CREATE OR REPLACE FUNCTION public.fn_recent_whatsapp_meta_delivery_blocks(
  p_window_minutes integer DEFAULT 30,
  p_minimum_failures integer DEFAULT 5
)
RETURNS TABLE (
  phone_number_id text,
  error_code text,
  error_message text,
  failure_count bigint,
  first_failure_at timestamptz,
  last_failure_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH failures AS (
    SELECT
      wm.business_phone_number_id AS phone_number_id,
      COALESCE(
        wm.status_error #>> '{error,code}',
        wm.status_error ->> 'code',
        wm.status_error #>> '{0,code}'
      ) AS error_code,
      COALESCE(
        wm.status_error #>> '{error,error_data,details}',
        wm.status_error #>> '{error,message}',
        wm.status_error ->> 'message',
        wm.status_error #>> '{0,message}',
        'Meta delivery blocked'
      ) AS error_message,
      wm.created_at
    FROM public.whatsapp_messages wm
    WHERE wm.status = 'failed'
      AND wm.business_phone_number_id IS NOT NULL
      AND wm.created_at >= now() - make_interval(mins => greatest(5, least(p_window_minutes, 1440)))
  )
  SELECT
    f.phone_number_id,
    f.error_code,
    max(f.error_message) AS error_message,
    count(*) AS failure_count,
    min(f.created_at) AS first_failure_at,
    max(f.created_at) AS last_failure_at
  FROM failures f
  WHERE f.error_code = ANY (ARRAY['131042', '131048', '133010', '190'])
  GROUP BY f.phone_number_id, f.error_code
  HAVING count(*) >= greatest(1, least(p_minimum_failures, 1000));
$$;
REVOKE ALL ON FUNCTION public.fn_recent_whatsapp_meta_delivery_blocks(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recent_whatsapp_meta_delivery_blocks(integer, integer) TO service_role;
