-- The last two trigger/RPC callers of whatsapp-send still authenticated with a
-- service-key Bearer. That key (SUPABASE_SERVICE_ROLE_KEY) is platform-injected
-- into the edge functions and drifted from every DB-side copy after the API-key
-- migration, so the strict `token === SERVICE_ROLE_KEY` check in whatsapp-send
-- 401'd. whatsapp-send also accepts `x-cron-secret === CRON_SECRET`, and
-- CRON_SECRET is a secret we control on both ends (vault + function env), so it
-- can't drift the same way. Switch these two to the same x-cron-secret idiom the
-- other whatsapp-send callers (fn_auto_welcome_lead etc.) already use.
--
-- Only the auth header changes; all other behaviour is identical. Idempotent.

CREATE OR REPLACE FUNCTION public.fn_offer_letter_send_whatsapp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token         uuid;
  v_lead          record;
  v_course_name   text;
  v_phone         text;
  v_deadline_str  text;
  v_net_fee_str   text;
  v_supabase_url  text;
  v_cron_secret   text;
BEGIN
  SELECT value INTO v_supabase_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT decrypted_secret INTO v_cron_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  IF v_supabase_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE NOTICE 'Skipping offer WhatsApp send — url/CRON_SECRET missing'; RETURN NEW;
  END IF;

  SELECT l.id, l.name, l.phone, c.name AS course_name INTO v_lead
    FROM public.leads l LEFT JOIN public.courses c ON c.id = NEW.course_id
   WHERE l.id = NEW.lead_id;
  IF v_lead.id IS NULL OR v_lead.phone IS NULL THEN
    RAISE NOTICE 'Skipping offer WhatsApp — lead or phone missing for offer %', NEW.id; RETURN NEW;
  END IF;

  v_course_name := COALESCE(v_lead.course_name, 'your selected course');
  v_phone       := regexp_replace(v_lead.phone, '[^0-9]', '', 'g');

  INSERT INTO public.apply_magic_tokens (lead_id, phone, expires_at, created_by)
  VALUES (NEW.lead_id, v_lead.phone, now() + interval '30 days', NEW.issued_by)
  RETURNING token INTO v_token;

  v_deadline_str := COALESCE(to_char(NEW.acceptance_deadline, 'DD Mon YYYY'), 'the deadline shared in the letter');
  v_net_fee_str  := COALESCE(to_char(NEW.net_fee, 'FM999999990'), 'TBD');

  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/whatsapp-send',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_cron_secret),
    body    := jsonb_build_object(
                 'template_key','offer_letter_acceptance','phone',v_phone,'lead_id',NEW.lead_id,
                 'params', jsonb_build_array(v_lead.name, v_course_name, v_net_fee_str, v_deadline_str),
                 'button_urls', jsonb_build_array(v_token::text))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_offer_letter_send_whatsapp failed for offer %: %', NEW.id, SQLERRM; RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_student_claim_link(_token_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tok           public.student_magic_tokens%ROWTYPE;
  v_supa_url      text;
  v_cron_secret   text;
  v_portal_base   text;
  v_claim_url     text;
  v_student_name  text;
  v_admission_no  text;
BEGIN
  SELECT * INTO v_tok FROM public.student_magic_tokens WHERE id = _token_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'token not found');
  END IF;
  IF v_tok.phone IS NULL OR v_tok.phone = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no phone on the token');
  END IF;

  SELECT value INTO v_supa_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT decrypted_secret INTO v_cron_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  IF v_supa_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE WARNING 'send_student_claim_link: missing supabase_url or CRON_SECRET';
    RETURN jsonb_build_object('sent', false, 'reason', 'messaging not configured');
  END IF;

  SELECT value INTO v_portal_base FROM public._app_config WHERE key = 'student_portal_base';
  v_claim_url := COALESCE(v_portal_base, 'https://uni.nimt.ac.in/student') || '?token=' || v_tok.token;

  SELECT name, admission_no INTO v_student_name, v_admission_no
    FROM public.students WHERE id = v_tok.student_id;

  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/whatsapp-send',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_cron_secret),
    body    := jsonb_build_object(
      'template_key', 'student_portal_invite',
      'phone',        v_tok.phone,
      'lead_id',      v_tok.lead_id,
      'params',       jsonb_build_array(COALESCE(v_student_name, 'Student'), COALESCE(v_admission_no, '')),
      'button_urls',  jsonb_build_array(v_claim_url)
    )
  );

  IF v_tok.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (v_tok.lead_id, 'system', 'Student-portal claim link sent via WhatsApp: ' || v_claim_url);
  END IF;

  RETURN jsonb_build_object('sent', true, 'phone', v_tok.phone, 'url', v_claim_url);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'send_student_claim_link failed for token %: %', _token_id, SQLERRM;
  RETURN jsonb_build_object('sent', false, 'reason', SQLERRM);
END;
$$;
