-- ====================================================================
-- Finance safety nets (Phase 2 follow-up):
--
--   1. Periodic provision reconciler — every 6 h, run
--      provision_student_fees() for any admitted student whose
--      fee_ledger is still empty. Catches the rare case where the
--      AN-issuance auto-trigger lost its pg_net call (transient
--      network blip, edge function cold-start fail).
--
--   2. Stale orphan alert — every 4 h during business hours, flag any
--      application whose pending_txnid was set >24 h ago but
--      payment_status is still 'pending'. WhatsApp super_admins.
--
--   3. Audit anomaly alert — real-time. AFTER INSERT on
--      payment_audit_log: if op=DELETE on a payment-bearing table OR
--      UPDATE that changes amount on lead_payments / payments, fire a
--      WhatsApp to every super_admin so destructive ops can't fly
--      under the radar.
-- ====================================================================

-- ────────── 1. Provision reconciler cron ────────────────────────────
SELECT cron.unschedule('provision-orphan-students')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'provision-orphan-students');

SELECT cron.schedule(
  'provision-orphan-students',
  '15 */6 * * *',  -- every 6h at minute 15
  $$
  DO $body$
  DECLARE
    v_lead_id uuid;
    v_count int := 0;
  BEGIN
    FOR v_lead_id IN
      SELECT l.id
        FROM public.leads l
        JOIN public.students s ON s.lead_id = l.id
       WHERE l.admission_no IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.fee_ledger fl WHERE fl.student_id = s.id
         )
       LIMIT 50  -- per-tick cap so a backlog doesn't run forever
    LOOP
      PERFORM public.provision_student_fees(v_lead_id);
      v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN
      RAISE NOTICE '[provision-cron] reconciled % admitted students with missing ledger', v_count;
    END IF;
  END
  $body$;
  $$
);

-- ────────── 2. Stale-orphan alert cron ─────────────────────────────
-- Runs at 10:00, 14:00, 18:00 IST. Each fire posts a notify-event call
-- with the count + first 5 application_ids; the notify-event function
-- already knows how to send WhatsApp to super_admins.

CREATE OR REPLACE FUNCTION public.report_stale_orphan_applications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    text;
  v_key    text;
  v_count  int;
  v_sample text;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.applications
   WHERE payment_status = 'pending'
     AND fee_amount > 0
     AND pending_txnid IS NOT NULL
     AND created_at < now() - interval '24 hours';

  IF v_count = 0 THEN
    RETURN;
  END IF;

  SELECT string_agg(application_id, ', ' ORDER BY created_at DESC) INTO v_sample
    FROM (
      SELECT application_id, created_at
        FROM public.applications
       WHERE payment_status = 'pending'
         AND fee_amount > 0
         AND pending_txnid IS NOT NULL
         AND created_at < now() - interval '24 hours'
       ORDER BY created_at DESC
       LIMIT 5
    ) t;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[orphan-alert] _app_config missing supabase_url/service_role_key — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/notify-event',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
    body    := jsonb_build_object(
      'event', 'finance_orphan_alert',
      'severity', 'warning',
      'channels', ARRAY['whatsapp'],
      'audience', 'super_admin',
      'title', 'Stale orphan applications',
      'body', format(
        'There are %s applications with payment_status=pending and pending_txnid set for more than 24h. First few: %s. Run reconciliation in Finance → Online Txns.',
        v_count, v_sample
      )
    )::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_stale_orphan_applications() TO service_role;

SELECT cron.unschedule('finance-stale-orphan-alert')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-stale-orphan-alert');

SELECT cron.schedule(
  'finance-stale-orphan-alert',
  '30 4,8,12 * * *',  -- 10:00, 14:00, 18:00 IST (UTC = -5:30)
  $$ SELECT public.report_stale_orphan_applications(); $$
);

-- ────────── 3. Audit-anomaly real-time alert ───────────────────────
-- Fires WhatsApp to super_admins whenever anyone deletes a payment row
-- or edits the amount on an existing one. Both are rare and
-- destructive; an alert ensures we notice within minutes.

CREATE OR REPLACE FUNCTION public.fn_audit_anomaly_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url       text;
  v_key       text;
  v_severity  text;
  v_title     text;
  v_body      text;
  v_amount_changed boolean := false;
BEGIN
  -- Only watch high-risk events
  IF NEW.op = 'DELETE'
     AND NEW.table_name IN ('lead_payments','payments','fee_ledger','fee_ledger_payments') THEN
    v_severity := 'critical';
    v_title    := format('🚨 %s row DELETED', NEW.table_name);
  ELSIF NEW.op = 'UPDATE'
     AND NEW.table_name IN ('lead_payments','payments')
     AND NEW.delta IS NOT NULL
     AND (NEW.delta ? 'amount') THEN
    v_severity := 'warning';
    v_title    := format('⚠ %s.amount edited', NEW.table_name);
    v_amount_changed := true;
  ELSE
    RETURN NEW;
  END IF;

  v_body := format(
    'Identifier: %s · Row: %s · Actor: %s (%s) · Time: %s%s',
    COALESCE(NEW.natural_key, '—'),
    SUBSTRING(NEW.row_id::text FROM 1 FOR 8),
    COALESCE(NEW.actor_user_id::text, 'system'),
    COALESCE(NEW.actor_role, '—'),
    to_char(NEW.event_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI IST'),
    CASE WHEN v_amount_changed
         THEN format(' · Amount: %s → %s',
                     NEW.delta->'amount'->>'from',
                     NEW.delta->'amount'->>'to')
         ELSE '' END
  );

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/notify-event',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
    body    := jsonb_build_object(
      'event', 'finance_audit_anomaly',
      'severity', v_severity,
      'channels', ARRAY['whatsapp'],
      'audience', 'super_admin',
      'title', v_title,
      'body', v_body
    )::text
  );

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_audit_anomaly_alert() TO service_role;

DROP TRIGGER IF EXISTS trg_audit_anomaly_alert ON public.payment_audit_log;
CREATE TRIGGER trg_audit_anomaly_alert
  AFTER INSERT ON public.payment_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_anomaly_alert();
