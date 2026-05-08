-- Replace the http_post-based alerts with direct INSERTs into the
-- existing `notifications` table (bell icon). The earlier version
-- targeted notify-event but that function expects structured lifecycle
-- events, not free-form ops alerts. Notifications table is already the
-- canonical channel for "admin should see this now" — no Meta template
-- dependency, no extra function to deploy.

-- ────────── Stale-orphan alert: write to notifications ─────────────
CREATE OR REPLACE FUNCTION public.report_stale_orphan_applications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  int;
  v_sample text;
  v_user   uuid;
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

  -- One notification per super_admin / admission_head — they all see
  -- the alert in the bell. Dedup against a same-day duplicate so a
  -- 4-hour cron doesn't spam the inbox.
  FOR v_user IN
    SELECT user_id FROM public.user_roles
     WHERE role IN ('super_admin','admission_head')
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.notifications
       WHERE user_id = v_user
         AND type = 'finance_orphan_alert'
         AND created_at > now() - interval '6 hours'
    ) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      v_user,
      'finance_orphan_alert',
      format('%s applications still pending payment', v_count),
      format(
        '%s applications have payment_status=pending with pending_txnid set for >24h. Sample: %s. Run reconciliation in Finance → Online Txns.',
        v_count, v_sample
      ),
      '/finance?tab=online-transactions'
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_stale_orphan_applications() TO service_role;

-- ────────── Audit anomaly alert: write to notifications ────────────
CREATE OR REPLACE FUNCTION public.fn_audit_anomaly_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_severity text;
  v_title    text;
  v_body     text;
  v_user     uuid;
  v_amount_changed boolean := false;
BEGIN
  IF NEW.op = 'DELETE'
     AND NEW.table_name IN ('lead_payments','payments','fee_ledger','fee_ledger_payments') THEN
    v_severity := 'critical';
    v_title    := format('🚨 %s row deleted', NEW.table_name);
  ELSIF NEW.op = 'UPDATE'
     AND NEW.table_name IN ('lead_payments','payments')
     AND NEW.delta IS NOT NULL
     AND (NEW.delta ? 'amount') THEN
    v_severity := 'warning';
    v_title    := format('⚠ %s amount edited', NEW.table_name);
    v_amount_changed := true;
  ELSE
    RETURN NEW;
  END IF;

  v_body := format(
    'Identifier: %s · Row: %s · Actor: %s%s · Time: %s%s',
    COALESCE(NEW.natural_key, '—'),
    SUBSTRING(NEW.row_id::text FROM 1 FOR 8),
    COALESCE(NEW.actor_user_id::text, 'system'),
    CASE WHEN NEW.actor_role IS NOT NULL THEN ' (' || NEW.actor_role || ')' ELSE '' END,
    to_char(NEW.event_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon HH24:MI IST'),
    CASE WHEN v_amount_changed
         THEN format(' · ₹%s → ₹%s',
                     NEW.delta->'amount'->>'from',
                     NEW.delta->'amount'->>'to')
         ELSE '' END
  );

  FOR v_user IN
    SELECT user_id FROM public.user_roles WHERE role = 'super_admin'
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      v_user,
      'finance_audit_anomaly',
      v_title,
      v_body,
      '/finance?tab=audit'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_audit_anomaly_alert() TO service_role;
