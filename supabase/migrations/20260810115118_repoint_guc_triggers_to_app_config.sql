-- Repoint the two GUC-based trigger functions onto public._app_config.
--
-- These were the only callers still reading the service key / url from the
-- `app.settings.*` GUC via current_setting(). That GUC is NOT set on this
-- database (only app.settings.jwt_exp exists), so both functions sent a NULL
-- bearer and every downstream edge call 401'd — independently of the
-- _app_config service_role_key rotation. Point them at _app_config (the one
-- source of truth every other trigger already uses) so a single key update
-- keeps them working. Bodies are otherwise unchanged.
--
-- Idempotent: CREATE OR REPLACE, safe to re-run.

-- 1. offer_letter_acceptance WhatsApp autosend --------------------------------
CREATE OR REPLACE FUNCTION public.fn_offer_letter_send_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token         uuid;
  v_lead          record;
  v_course_name   text;
  v_phone         text;
  v_deadline_str  text;
  v_net_fee_str   text;
  v_supabase_url  text;
  v_service_key   text;
BEGIN
  -- Source url + service key from _app_config (was app.settings.* GUC).
  SELECT value INTO v_supabase_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key  FROM public._app_config WHERE key = 'service_role_key';
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'Skipping offer WhatsApp send — _app_config url/key missing';
    RETURN NEW;
  END IF;

  SELECT l.id, l.name, l.phone, c.name AS course_name
    INTO v_lead
    FROM public.leads l
    LEFT JOIN public.courses c ON c.id = NEW.course_id
   WHERE l.id = NEW.lead_id;

  IF v_lead.id IS NULL OR v_lead.phone IS NULL THEN
    RAISE NOTICE 'Skipping offer WhatsApp — lead or phone missing for offer %', NEW.id;
    RETURN NEW;
  END IF;

  v_course_name := COALESCE(v_lead.course_name, 'your selected course');
  v_phone       := regexp_replace(v_lead.phone, '[^0-9]', '', 'g');

  INSERT INTO public.apply_magic_tokens (lead_id, phone, expires_at, created_by)
  VALUES (NEW.lead_id, v_lead.phone, now() + interval '30 days', NEW.issued_by)
  RETURNING token INTO v_token;

  v_deadline_str := COALESCE(to_char(NEW.acceptance_deadline, 'DD Mon YYYY'),
                             'the deadline shared in the letter');
  v_net_fee_str  := COALESCE(to_char(NEW.net_fee, 'FM999999990'), 'TBD');

  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/whatsapp-send',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_service_key
               ),
    body    := jsonb_build_object(
                 'template_key', 'offer_letter_acceptance',
                 'phone',        v_phone,
                 'lead_id',      NEW.lead_id,
                 'params',       jsonb_build_array(
                                   v_lead.name,
                                   v_course_name,
                                   v_net_fee_str,
                                   v_deadline_str
                                 ),
                 'button_urls',  jsonb_build_array(v_token::text)
               )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_offer_letter_send_whatsapp failed for offer %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- 2. automation-engine on lead stage change / assignment ----------------------
CREATE OR REPLACE FUNCTION public.fn_trigger_automation_on_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url  text;
  v_key  text;
BEGIN
  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Skipping automation-engine call — _app_config url/key missing';
    RETURN NEW;
  END IF;

  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/automation-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'trigger_type', 'stage_change',
        'lead_id', NEW.id,
        'old_stage', OLD.stage::text,
        'new_stage', NEW.stage::text
      )
    );
  END IF;

  IF OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id AND NEW.counsellor_id IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/automation-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'trigger_type', 'lead_assigned',
        'lead_id', NEW.id,
        'counsellor_id', NEW.counsellor_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
