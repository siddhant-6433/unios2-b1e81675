-- Auto-send the offer_letter_acceptance WhatsApp template when an offer is
-- issued. Reuses the existing apply_magic_tokens infrastructure so the lead
-- gets a single-tap link that authenticates them into the apply portal,
-- shows the offer letter, and routes into the existing token-fee payment
-- flow — no separate auth, no second OTP.
--
-- Flow:
--   1. counsellor issues offer → offer_letters INSERT
--   2. trigger creates apply_magic_tokens row (30-day expiry)
--   3. trigger fires whatsapp-send via pg_net with template_key
--      offer_letter_acceptance and button_urls=[token]
--   4. lead taps WhatsApp button → https://uni.nimt.ac.in/apply/offer/{token}
--   5. React route calls redeem-apply-link, then loads the offer view
--      (existing get_applicant_offer RPC).
--
-- The trigger is best-effort: WhatsApp send failures are logged but do not
-- block the offer insert.

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
  -- Defensive: skip if either of the trigger settings is not configured
  -- (happens in local dev / test envs without the cron pipeline wired up).
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key  := current_setting('app.settings.service_role_key', true);
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'Skipping offer WhatsApp send — pg settings missing';
    RETURN NEW;
  END IF;

  -- Pull lead + course context. If the lead has no phone we cannot send;
  -- the offer is still recorded so the counsellor can act on it manually.
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

  -- Magic token, 30 days validity (offer acceptance is rarely instant).
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

DROP TRIGGER IF EXISTS trg_offer_letter_send_whatsapp ON public.offer_letters;
CREATE TRIGGER trg_offer_letter_send_whatsapp
  AFTER INSERT ON public.offer_letters
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_offer_letter_send_whatsapp();

COMMENT ON FUNCTION public.fn_offer_letter_send_whatsapp() IS
  'Auto-sends offer_letter_acceptance WhatsApp template on offer issuance. Generates an apply_magic_tokens row so the recipient taps once and lands in the apply portal already authenticated. Best-effort — failures are logged but do not block the offer insert.';
