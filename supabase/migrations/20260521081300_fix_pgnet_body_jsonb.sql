-- Fix: pg_net `net.http_post(body)` parameter is jsonb, not text.
-- Three trigger functions cast body to ::text which causes
-- "function net.http_post(url → text, headers → jsonb, body → text) does not exist".
-- Symptom: recording an offline Token Fee failed because the token-fee
-- engine cascades into students.admission_no, firing
-- auto_provision_fees_on_admission whose net.http_post call exploded.

CREATE OR REPLACE FUNCTION public.auto_provision_fees_on_admission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url  text;
  v_key  text;
BEGIN
  IF NEW.admission_no IS NULL OR OLD.admission_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[auto_provision_fees] _app_config missing supabase_url or service_role_key; skipping auto-provision for student %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/provision-student-fees',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('student_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_lead_payment_to_application_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id text;
  v_app_status text;
BEGIN
  IF NEW.type <> 'application_fee' THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT application_id, payment_status
    INTO v_app_id, v_app_status
    FROM public.applications
   WHERE lead_id = NEW.lead_id
     AND payment_status IS DISTINCT FROM 'paid'
   ORDER BY updated_at DESC
   LIMIT 1;

  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.applications
     SET payment_status = 'paid',
         payment_ref    = COALESCE(payment_ref, NEW.transaction_ref, NEW.receipt_no)
   WHERE application_id = v_app_id;

  DECLARE
    v_url text;
    v_key text;
  BEGIN
    SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
    SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url     := v_url || '/functions/v1/generate-application-fee-receipt',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body    := jsonb_build_object('application_id', v_app_id)
      );
    END IF;
  END;

  RETURN NEW;
END;
$$;
