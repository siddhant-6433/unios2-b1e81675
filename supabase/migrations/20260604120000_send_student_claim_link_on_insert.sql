-- Auto-send the StudentPortal claim link via WhatsApp when a
-- student_magic_tokens row is inserted (which the AN-issuance trigger does).
--
-- Async via pg_net so the originating lead_payments transaction never blocks.
-- Fails silently if WhatsApp is misconfigured / template not yet approved
-- in Meta — the token is already created and visible in lead_activities,
-- so admin can deliver the link manually as a fallback.

CREATE OR REPLACE FUNCTION public.fn_send_student_claim_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supa_url      text;
  v_service_key   text;
  v_portal_base   text;
  v_claim_url     text;
  v_student_name  text;
  v_admission_no  text;
BEGIN
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_supa_url    FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'fn_send_student_claim_link: _app_config missing supabase_url or service_role_key';
    RETURN NEW;
  END IF;

  -- Configurable portal base; defaults to apply.nimt.ac.in/student. Stored in
  -- _app_config so deploy environments can override without code changes.
  SELECT value INTO v_portal_base FROM public._app_config WHERE key = 'student_portal_base';
  v_claim_url := COALESCE(v_portal_base, 'https://uni.nimt.ac.in/student') || '?token=' || NEW.token;

  SELECT name, admission_no
    INTO v_student_name, v_admission_no
  FROM public.students
  WHERE id = NEW.student_id;

  -- Body params (positional): student_name, admission_no
  -- Button URL gets the claim link appended as the dynamic suffix.
  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/whatsapp-send',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'template_key', 'student_portal_invite',
      'phone',        NEW.phone,
      'lead_id',      NEW.lead_id,
      'params',       jsonb_build_array(
        COALESCE(v_student_name, 'Student'),
        COALESCE(v_admission_no, '')
      ),
      'button_urls',  jsonb_build_array(v_claim_url)
    )
  );

  -- Log the URL so admin can resend manually if WA delivery failed.
  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (
    NEW.lead_id, 'system',
    'Student-portal claim link sent via WhatsApp: ' || v_claim_url
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Send student claim link failed for token %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_send_student_claim_link ON public.student_magic_tokens;
CREATE TRIGGER trg_send_student_claim_link
  AFTER INSERT ON public.student_magic_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_send_student_claim_link();
