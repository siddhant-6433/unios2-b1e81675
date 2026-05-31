-- Make fn_automation_on_lead_created honor the skip_ai_call flag.
--
-- Background: the bulk importer sets skip_ai_call=true to suppress auto AI
-- calls on cold third-party lists. This was respected by the dedicated
-- fn_auto_ai_call_new_lead trigger, but the parallel
-- fn_automation_on_lead_created trigger ignored the flag — it always
-- POSTed to the automation-engine edge function, which then fired any
-- active lead_created automation rules (including the "New Lead → AI Voice
-- Call" rule that bypassed our gate). Result: a school_outreach import of
-- 598 leads queued 673 calls and shipped 51 before being noticed.
--
-- We treat skip_ai_call as a single "skip ALL automated outreach on
-- insert" signal, not just AI calls — the alternative (a separate
-- skip_automation column) would require updating every call site that
-- already passes skip_ai_call. Bulk-imported cold leads should never get
-- any automated WA/email/call without an explicit opt-in.

CREATE OR REPLACE FUNCTION public.fn_automation_on_lead_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_url text; v_secret text;
BEGIN
  IF NEW.is_mirror = true THEN RETURN NEW; END IF;
  IF NEW.skip_ai_call = true THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET'  LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/automation-engine',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    body    := jsonb_build_object('trigger_type','lead_created','lead_id',NEW.id,'new_stage',NEW.stage));
  RETURN NEW;
END $function$;
