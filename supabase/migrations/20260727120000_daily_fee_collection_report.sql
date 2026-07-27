-- Daily fee collection report email.
--
-- (a) RPC that returns the previous day's confirmed collections enriched with
--     course / campus / cashier names, over the v_all_payments union.
-- (b) pg_cron job that POSTs the daily-fee-collection-report edge function.
--     18:31 UTC is 00:01 IST.

CREATE OR REPLACE FUNCTION public.get_daily_fee_collection(
  p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  paid_at timestamptz, receipt_no text, person_name text,
  course_name text, campus_name text, payment_mode text,
  amount numeric, fee_type text, gateway text, source text, cashier_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vap.paid_at, vap.receipt_no, vap.person_name,
         co.name AS course_name, ca.name AS campus_name,
         vap.payment_mode, vap.amount, vap.fee_type, vap.gateway, vap.source,
         pr.display_name AS cashier_name
  FROM public.v_all_payments vap
  LEFT JOIN public.campuses ca ON ca.id = vap.campus_id
  LEFT JOIN public.profiles pr ON pr.id = vap.recorded_by
  LEFT JOIN public.students st ON st.id = vap.student_id
  LEFT JOIN public.leads    ld ON ld.id = vap.lead_id
  LEFT JOIN public.courses  co ON co.id = COALESCE(st.course_id, ld.course_id)
  WHERE vap.paid_at >= p_from AND vap.paid_at < p_to
  ORDER BY vap.payment_mode, vap.paid_at;
$$;

REVOKE ALL ON FUNCTION public.get_daily_fee_collection(timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.get_daily_fee_collection(timestamptz, timestamptz) TO service_role;

SELECT cron.unschedule('daily-fee-collection-report')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-fee-collection-report');

SELECT cron.schedule(
  'daily-fee-collection-report',
  '31 18 * * *',
  $$
  SELECT net.http_post(
    url     := coalesce(
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
                 (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               ) || '/functions/v1/daily-fee-collection-report',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body    := jsonb_build_object('trigger', 'pg_cron'),
    timeout_milliseconds := 25000
  )
  $$
);
