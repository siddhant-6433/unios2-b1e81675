-- Visit Closure Enforcement System
-- 1. View for unclosed visits (today + past)
-- 2. No-show auto-followup trigger
-- 3. Visit confirmation cron (9 AM IST)
-- 4. Visit closure check cron (4:30 PM IST)

-- ── 1. View: visits that should have been closed but weren't ──
CREATE OR REPLACE VIEW public.visits_unclosed_today
WITH (security_invoker = on) AS
SELECT
  cv.id AS visit_id,
  cv.lead_id,
  cv.campus_id,
  cv.visit_date,
  cv.status,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.counsellor_id,
  cam.name AS campus_name,
  p.display_name AS counsellor_name,
  p.user_id AS counsellor_user_id
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
LEFT JOIN public.profiles p ON p.id = l.counsellor_id
WHERE cv.status IN ('scheduled', 'confirmed')
  AND cv.visit_date::date <= CURRENT_DATE
  AND cv.visit_date::date >= CURRENT_DATE - 7;  -- cap at 7 days to avoid noise

GRANT SELECT ON public.visits_unclosed_today TO authenticated, service_role;

-- ── 2. No-show auto-followup trigger ──
CREATE OR REPLACE FUNCTION public.fn_visit_no_show_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_date date;
  v_counsellor_user_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'no_show' AND NEW.status = 'no_show' THEN
    -- Next business day (skip Sunday)
    v_next_date := CURRENT_DATE + 1;
    IF EXTRACT(DOW FROM v_next_date) = 0 THEN
      v_next_date := v_next_date + 1;
    END IF;

    -- Auto-create follow-up call for next business day 10 AM
    INSERT INTO public.lead_followups (lead_id, scheduled_at, type, notes, status)
    VALUES (
      NEW.lead_id,
      (v_next_date || ' 04:30:00+00')::timestamptz,  -- 10:00 AM IST
      'call',
      'Auto: No-show follow-up. Original visit was ' || to_char(NEW.visit_date, 'DD Mon YYYY') || '. Call to reschedule or close.',
      'pending'
    );

    -- Notify counsellor
    SELECT p.user_id INTO v_counsellor_user_id
    FROM leads l JOIN profiles p ON p.id = l.counsellor_id
    WHERE l.id = NEW.lead_id;

    IF v_counsellor_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
      VALUES (
        v_counsellor_user_id,
        'visit_no_show',
        'No-show: Follow-up scheduled',
        'Visit marked no-show. Follow-up call auto-scheduled for ' || to_char(v_next_date, 'DD Mon') || '. Call to reschedule or close.',
        '/admissions/' || NEW.lead_id,
        NEW.lead_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visit_no_show_followup ON public.campus_visits;
CREATE TRIGGER trg_visit_no_show_followup
  AFTER UPDATE ON public.campus_visits
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_no_show_followup();

-- ── 3. Visit confirmation cron — 9 AM IST (3:30 UTC) Mon-Sat ──
SELECT cron.schedule(
  'visit-confirmation-reminder',
  '30 3 * * 1-6',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/visit-confirmation-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- ── 4. Visit closure check — 4:30 PM IST (11:00 UTC) Mon-Sat ──
SELECT cron.schedule(
  'visit-closure-check',
  '0 11 * * 1-6',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/visit-closure-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
