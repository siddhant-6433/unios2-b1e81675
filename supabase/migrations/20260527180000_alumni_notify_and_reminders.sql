-- Email notifications + daily TAT reminders for alumni service requests.
--
-- 1. When a request transitions to status='paid' (any of the 4 service types
--    — verification, marksheet, diploma, transcript), fire alumni-notify
--    with kind=new_request. Goes to umesh@nimt.ac.in cc siddhant+siddharth.
--
-- 2. Daily at 08:00 IST (02:30 UTC), scan open requests whose due_date is
--    between today and today+2 (i.e. day 3, 4, and 5 mornings of the 5-day
--    TAT, where day 5 = due_date itself = last day). For each, fire
--    alumni-notify with kind=reminder so the team sees pending requests
--    every morning until they update the status to verified/rejected.

-- ── 1. Trigger function: fire on status → 'paid' ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_alumni_paid_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supa_url    text;
  v_service_key text;
BEGIN
  SELECT value INTO v_supa_url    FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'fn_alumni_paid_notify: _app_config missing supabase_url or service_role_key';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/alumni-notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'kind',       'new_request',
      'request_id', NEW.id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_alumni_paid_notify failed for request %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alumni_paid_notify ON public.alumni_verification_requests;
CREATE TRIGGER trg_alumni_paid_notify
  AFTER UPDATE OF status ON public.alumni_verification_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'paid' AND NEW.status = 'paid')
  EXECUTE FUNCTION public.fn_alumni_paid_notify();

-- Also cover the (rare) case where a row is inserted directly with status=paid.
DROP TRIGGER IF EXISTS trg_alumni_paid_notify_insert ON public.alumni_verification_requests;
CREATE TRIGGER trg_alumni_paid_notify_insert
  AFTER INSERT ON public.alumni_verification_requests
  FOR EACH ROW
  WHEN (NEW.status = 'paid')
  EXECUTE FUNCTION public.fn_alumni_paid_notify();

-- ── 2. Daily TAT reminder cron ───────────────────────────────────────────
-- Day 5 of a 5-day TAT = due_date itself. We want reminders on day 3, 4, 5
-- mornings. Day 3 morning = due_date - 2 days. Day 5 morning = due_date.
-- So fire for rows where (due_date - CURRENT_DATE) BETWEEN 0 AND 2.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alumni-tat-reminders') THEN
    PERFORM cron.unschedule('alumni-tat-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'alumni-tat-reminders',
  '30 2 * * *',  -- 02:30 UTC = 08:00 IST every day
  $cron$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/alumni-notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := jsonb_build_object(
      'kind',           'reminder',
      'request_id',     avr.id,
      'days_remaining', (avr.due_date - CURRENT_DATE)
    )
  )
  FROM public.alumni_verification_requests avr
  WHERE avr.status NOT IN ('verified', 'rejected', 'pending_payment')
    AND avr.due_date IS NOT NULL
    AND (avr.due_date - CURRENT_DATE) BETWEEN 0 AND 2;
  $cron$
);
