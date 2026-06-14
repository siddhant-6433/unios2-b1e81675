-- Marketing conversion milestones for GA/GTM and Meta CAPI.
--
-- Intent ladder:
--   1. visit_completed       value = 0, because it signals high intent but no cash
--   2. application_fee_paid  value = application fee amount
--   3. token_fee_submitted   value = token fee amount
--
-- These are database-side because visits and payments are often completed by
-- staff, webhooks, or offline reconciliation where the applicant's browser is
-- not present. GA events are emitted through Measurement Protocol; Meta events
-- are emitted through the CAPI relay.

------------------------------------------------------------------------
-- 1. Relay helpers with optional metadata
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_ga_relay_post_with_params(
  _lead_id        uuid,
  _event_name     text,
  _value          numeric DEFAULT NULL,
  _transaction_id text DEFAULT NULL,
  _extra_params   jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url  text;
  v_key  text;
  v_body jsonb;
BEGIN
  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  v_body := jsonb_strip_nulls(jsonb_build_object(
    'lead_id',        _lead_id,
    'event_name',     _event_name,
    'value',          _value,
    'transaction_id', _transaction_id
  ));

  IF COALESCE(_extra_params, '{}'::jsonb) <> '{}'::jsonb THEN
    v_body := v_body || jsonb_build_object('extra_params', _extra_params);
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/ga-conversions',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := v_body
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ga milestone relay failed for lead % event %: %', _lead_id, _event_name, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_capi_relay_post_with_custom(
  _lead_id        uuid,
  _event_name     text,
  _event_id       text,
  _value          numeric DEFAULT NULL,
  _transaction_id text DEFAULT NULL,
  _custom_data    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url  text;
  v_key  text;
  v_body jsonb;
BEGIN
  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  v_body := jsonb_strip_nulls(jsonb_build_object(
    'lead_id',        _lead_id,
    'event_name',     _event_name,
    'event_id',       _event_id,
    'value',          _value,
    'currency',       'INR',
    'transaction_id', _transaction_id
  ));

  IF COALESCE(_custom_data, '{}'::jsonb) <> '{}'::jsonb THEN
    v_body := v_body || jsonb_build_object('custom_data', _custom_data);
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/meta-capi-events',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := v_body
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'meta capi milestone relay failed for lead % event %: %', _lead_id, _event_name, SQLERRM;
END;
$$;

------------------------------------------------------------------------
-- 2. Visit completed: high-intent, zero-value conversion
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_emit_visit_completed_marketing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id text;
  v_params   jsonb;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  v_event_id := 'visit_' || NEW.id::text;
  v_params := jsonb_strip_nulls(jsonb_build_object(
    'conversion_step', 'visit_completed',
    'funnel_rank', 20,
    'visit_id', NEW.id::text,
    'campus_id', NEW.campus_id::text
  ));

  PERFORM public.fn_ga_relay_post_with_params(
    NEW.lead_id,
    'visit_completed',
    0,
    v_event_id,
    v_params
  );

  PERFORM public.fn_capi_relay_post_with_custom(
    NEW.lead_id,
    'VisitCompleted',
    v_event_id,
    0,
    v_event_id,
    v_params || jsonb_build_object(
      'content_name', 'visit_completed',
      'content_category', 'admissions_funnel'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_visit_completed ON public.campus_visits;
CREATE TRIGGER trg_marketing_visit_completed
  AFTER INSERT OR UPDATE OF status ON public.campus_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_emit_visit_completed_marketing();

------------------------------------------------------------------------
-- 3. Paid milestones: application fee and token fee
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_emit_lead_payment_marketing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application_id text;
  v_event_id       text;
  v_ga_event       text;
  v_meta_event     text;
  v_step           text;
  v_rank           int;
  v_params         jsonb;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('application_fee', 'token_fee') THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'application_fee' THEN
    SELECT a.application_id
      INTO v_application_id
      FROM public.applications a
     WHERE a.lead_id = NEW.lead_id
     ORDER BY
       CASE WHEN NEW.transaction_ref IS NOT NULL AND a.payment_ref = NEW.transaction_ref THEN 0 ELSE 1 END,
       a.updated_at DESC NULLS LAST,
       a.created_at DESC NULLS LAST
     LIMIT 1;

    v_event_id   := 'reg_' || COALESCE(v_application_id, NEW.id::text);
    v_ga_event   := 'application_fee_paid';
    v_meta_event := 'CompleteRegistration';
    v_step       := 'application_fee_paid';
    v_rank       := 30;
  ELSE
    v_event_id   := 'token_' || NEW.id::text;
    v_ga_event   := 'token_fee_submitted';
    v_meta_event := 'TokenFeeSubmitted';
    v_step       := 'token_fee_submitted';
    v_rank       := 40;
  END IF;

  v_params := jsonb_strip_nulls(jsonb_build_object(
    'conversion_step', v_step,
    'funnel_rank', v_rank,
    'payment_id', NEW.id::text,
    'payment_type', NEW.type,
    'payment_mode', NEW.payment_mode,
    'application_id', v_application_id
  ));

  PERFORM public.fn_ga_relay_post_with_params(
    NEW.lead_id,
    v_ga_event,
    NEW.amount,
    v_event_id,
    v_params
  );

  PERFORM public.fn_capi_relay_post_with_custom(
    NEW.lead_id,
    v_meta_event,
    v_event_id,
    NEW.amount,
    v_event_id,
    v_params || jsonb_build_object(
      'content_name', v_step,
      'content_category', 'admissions_funnel'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_lead_payment_conversion ON public.lead_payments;
CREATE TRIGGER trg_marketing_lead_payment_conversion
  AFTER INSERT OR UPDATE OF status ON public.lead_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_emit_lead_payment_marketing();
