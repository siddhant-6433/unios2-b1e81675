-- Assign Round Robin of a 51-lead list timed out:
--   canceling statement due to statement timeout
--
-- assign_lead_list_round_robin already sets app.bulk_assign so
-- fn_notify_lead_assigned skips the per-lead notification (one summary
-- notification is written at the end). fn_automation_on_lead_assigned did
-- not honor that flag, so each counsellor_id write still:
--   1. decrypted vault secrets (twice)
--   2. net.http_post to automation-engine
-- For a list hand-off that is 51 HTTP automations — including
-- "Lead Assigned → WhatsApp to Counsellor" — inside one RPC.
-- Skip the same way notifications already do.
--
-- Also pin statement_timeout on the assign RPC itself. The body already
-- tries set_config('statement_timeout','300s'), but a function-level SET
-- applies as the function starts and is the form that reliably outlives
-- the PostgREST default.

CREATE OR REPLACE FUNCTION public.fn_automation_on_lead_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  IF current_setting('app.bulk_assign', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF (OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id) AND NEW.counsellor_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
    IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/automation-engine',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body    := jsonb_build_object('trigger_type', 'lead_assigned', 'lead_id', NEW.id, 'counsellor_id', NEW.counsellor_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'assign_lead_list_round_robin'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.assign_lead_list_round_robin(%s) SET statement_timeout = %L',
      r.args,
      '300s'
    );
  END LOOP;
END
$do$;
