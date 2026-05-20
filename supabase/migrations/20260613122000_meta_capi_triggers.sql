-- Meta CAPI dispatch triggers.
--
-- Mirrors 20260603120000_ga_conversion_triggers.sql one-for-one so the GA
-- and CAPI pipelines stay in lockstep. All three relays fire via pg_net
-- (async) — failures land in meta_event_log and never block the
-- originating transaction.
--
-- Event names match Meta's standard events vocabulary so the optimizer
-- gets the strongest signal:
--   • generate_lead  (GA) → Lead                 (Meta)
--   • purchase       (GA) → CompleteRegistration (Meta) — application fee paid
--   • admission_confirmed (GA) → AdmissionConfirmed (Meta custom event)
--
-- event_id construction is critical: it's the dedup key shared with the
-- browser Pixel fire. The browser uses the same shape (see analytics.ts
-- pixelEventId helpers) so Meta drops the duplicate within ~7 days.

------------------------------------------------------------------------
-- 1. Async relay caller — single helper used by all 3 triggers
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_capi_relay_post(
  _lead_id        uuid,
  _event_name     text,
  _event_id       text,
  _value          numeric DEFAULT NULL,
  _transaction_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT value INTO v_url FROM _app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM _app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/meta-capi-events',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_strip_nulls(jsonb_build_object(
      'lead_id',        _lead_id,
      'event_name',     _event_name,
      'event_id',       _event_id,
      'value',          _value,
      'transaction_id', _transaction_id
    ))
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'capi relay failed for lead % event %: %', _lead_id, _event_name, SQLERRM;
END;
$$;

------------------------------------------------------------------------
-- 2. Lead — fires on every new lead INSERT (apply portal only)
------------------------------------------------------------------------
-- event_id = 'lead_<uuid>' — browser fires the same id from
-- trackPixelLead() in ApplyPortal.createApplication.

CREATE OR REPLACE FUNCTION public.fn_capi_emit_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Same origin_domain skip as GA: leads from other intake paths (CSV,
  -- counsellor manual create) have no Pixel attribution to attach to.
  IF NEW.origin_domain IS NULL THEN RETURN NEW; END IF;

  PERFORM public.fn_capi_relay_post(
    NEW.id,
    'Lead',
    'lead_' || NEW.id::text,
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capi_emit_lead ON public.leads;
CREATE TRIGGER trg_capi_emit_lead
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_capi_emit_lead();

------------------------------------------------------------------------
-- 3. CompleteRegistration — application fee payment confirmed
------------------------------------------------------------------------
-- event_id = 'reg_<application_id>' — the application_id is the cleanest
-- shared key with the browser fire (data.application_id in PaymentSection).
-- Falls back to lead_id when no application_id is set (rare — receipt
-- payments outside the apply flow).

CREATE OR REPLACE FUNCTION public.fn_capi_emit_app_fee_registered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_should_fire boolean := false;
  v_application_id text;
  v_event_id text;
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_fire := true;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') <> 'confirmed' THEN
    v_should_fire := true;
  END IF;

  IF NOT v_should_fire THEN RETURN NEW; END IF;

  SELECT application_id INTO v_application_id
  FROM public.leads WHERE id = NEW.lead_id;

  v_event_id := 'reg_' || COALESCE(v_application_id, NEW.lead_id::text);

  PERFORM public.fn_capi_relay_post(
    NEW.lead_id,
    'CompleteRegistration',
    v_event_id,
    NEW.amount,
    COALESCE(NEW.transaction_ref, NEW.receipt_no, NEW.id::text)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capi_emit_app_fee_registered ON public.lead_payments;
CREATE TRIGGER trg_capi_emit_app_fee_registered
  AFTER INSERT OR UPDATE OF status ON public.lead_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_capi_emit_app_fee_registered();

------------------------------------------------------------------------
-- 4. AdmissionConfirmed — leads.stage flips to 'admitted'
------------------------------------------------------------------------
-- Custom event (not in Meta's standard event vocabulary). Won't get the
-- optimizer's standard-event treatment but is fine for retargeting +
-- conversion lift analysis. Value = year-1 fee net of concessions.
--
-- No browser-side counterpart (admission happens via staff action in the
-- CRM, not in the apply portal), so no dedup concern.

CREATE OR REPLACE FUNCTION public.fn_capi_emit_admission_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value numeric;
BEGIN
  IF NEW.stage <> 'admitted' OR COALESCE(OLD.stage::text, '') = 'admitted' THEN
    RETURN NEW;
  END IF;

  v_value := public.lead_first_year_net_fee(NEW.id);

  PERFORM public.fn_capi_relay_post(
    NEW.id,
    'AdmissionConfirmed',
    'adm_' || NEW.id::text,
    v_value,
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capi_emit_admission_confirmed ON public.leads;
CREATE TRIGGER trg_capi_emit_admission_confirmed
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_capi_emit_admission_confirmed();
