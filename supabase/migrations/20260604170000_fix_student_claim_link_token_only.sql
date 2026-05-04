-- Fix: fn_send_student_claim_link was passing the FULL claim URL as the
-- button_urls suffix, but Meta substitutes only the {{1}} portion of the
-- template URL (https://uni.nimt.ac.in/student?token={{1}}). The full URL
-- caused the rendered button to read https://uni.nimt.ac.in/student?token=https://uni.nimt.ac.in/student?token=<actual>
-- — broken link. Pass the bare token instead.

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

  -- Full URL is still constructed for the lead_activities log so admins
  -- have a copy-paste fallback if WhatsApp delivery fails.
  SELECT value INTO v_portal_base FROM public._app_config WHERE key = 'student_portal_base';
  v_claim_url := COALESCE(v_portal_base, 'https://uni.nimt.ac.in/student') || '?token=' || NEW.token;

  SELECT name, admission_no
    INTO v_student_name, v_admission_no
  FROM public.students
  WHERE id = NEW.student_id;

  -- button_urls = [token UUID]. Template URL https://uni.nimt.ac.in/student?token={{1}}
  -- gets {{1}} replaced with NEW.token to form the live click-through.
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
      'button_urls',  jsonb_build_array(NEW.token::text)
    )
  );

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
