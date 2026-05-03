-- GA4 conversion triggers — fire ga-conversions edge function on the
-- three lead-lifecycle events the business cares about:
--   1. generate_lead       on every new lead INSERT (no value)
--   2. purchase            when an application_fee payment confirms
--                          (value = amount paid)
--   3. admission_confirmed when leads.stage transitions to 'admitted'
--                          (value = first-year fee net of waivers)
--
-- All HTTP calls are async via pg_net — triggers complete in microseconds
-- and never block the originating transaction. Failures land in
-- ga_event_log via the edge function's audit hook.
--
-- Routing (origin_domain → GA property + secret) lives entirely in the
-- edge function; this migration only relays the event name + value.

------------------------------------------------------------------------
-- 1. Helper: first-year fee net of year_1 concessions
------------------------------------------------------------------------
-- Reads gross from lead_first_year_fee (sum of fee_structure_items where
-- term='year_1') and subtracts the year_1 slice of every confirmed
-- payment's concession_breakdown JSONB.
--
-- Why this and not fee_ledger.concession: fee_ledger is only populated
-- once an admission number is provisioned. We want a value at the
-- moment stage flips to 'admitted', which can happen before AN. Falling
-- back to lead_payments + breakdown gives us the right number throughout
-- the lifecycle.

CREATE OR REPLACE FUNCTION public.lead_first_year_net_fee(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    public.lead_first_year_fee(_lead_id)
    - COALESCE((
        SELECT SUM(COALESCE((lp.concession_breakdown ->> 'year_1')::numeric, 0))
        FROM public.lead_payments lp
        WHERE lp.lead_id = _lead_id
          AND lp.status = 'confirmed'
          AND lp.concession_breakdown IS NOT NULL
      ), 0),
    0
  )::numeric;
$$;

GRANT EXECUTE ON FUNCTION public.lead_first_year_net_fee TO authenticated, service_role;

------------------------------------------------------------------------
-- 2. Async relay caller — single helper used by all 3 triggers
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_ga_relay_post(
  _lead_id        uuid,
  _event_name     text,
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
    url     := v_url || '/functions/v1/ga-conversions',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_strip_nulls(jsonb_build_object(
      'lead_id',        _lead_id,
      'event_name',     _event_name,
      'value',          _value,
      'transaction_id', _transaction_id
    ))
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let GA relay failures break the originating transaction.
  RAISE WARNING 'ga relay failed for lead % event %: %', _lead_id, _event_name, SQLERRM;
END;
$$;

------------------------------------------------------------------------
-- 3. generate_lead — fires on every new lead INSERT
------------------------------------------------------------------------
-- No value sent. GA Admin → Events: mark `generate_lead` as Key Event.

CREATE OR REPLACE FUNCTION public.fn_ga_emit_generate_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip if origin_domain isn't set (legacy/CSV imports etc) — the
  -- edge function would reject these anyway. Saves a wasted HTTP call.
  IF NEW.origin_domain IS NULL THEN RETURN NEW; END IF;

  PERFORM public.fn_ga_relay_post(NEW.id, 'generate_lead', NULL, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_emit_generate_lead ON public.leads;
CREATE TRIGGER trg_ga_emit_generate_lead
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ga_emit_generate_lead();

------------------------------------------------------------------------
-- 4. purchase — fires when an application_fee payment confirms
------------------------------------------------------------------------
-- Value = the amount paid (real money received). Marks `purchase` as
-- the standard GA4 revenue event so the GA dashboard's revenue total
-- is meaningful.
--
-- Fires on:
--   • INSERT with status='confirmed' (most common — gateway success)
--   • UPDATE flipping status to 'confirmed' (manual reconciliation)

CREATE OR REPLACE FUNCTION public.fn_ga_emit_app_fee_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_should_fire boolean := false;
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_fire := true;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') <> 'confirmed' THEN
    v_should_fire := true;
  END IF;

  IF v_should_fire THEN
    PERFORM public.fn_ga_relay_post(
      NEW.lead_id,
      'purchase',
      NEW.amount,
      COALESCE(NEW.transaction_ref, NEW.receipt_no, NEW.id::text)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_emit_app_fee_purchase ON public.lead_payments;
CREATE TRIGGER trg_ga_emit_app_fee_purchase
  AFTER INSERT OR UPDATE OF status ON public.lead_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ga_emit_app_fee_purchase();

------------------------------------------------------------------------
-- 5. admission_confirmed — fires when leads.stage flips to 'admitted'
------------------------------------------------------------------------
-- Value = lead_first_year_net_fee (gross year_1 minus year_1
-- concessions). This is projected revenue, NOT real cash — kept as a
-- custom event (not `purchase`) so GA's actual-revenue total stays clean.
-- Build a Pipeline-Value report in GA Explorations using this event.

CREATE OR REPLACE FUNCTION public.fn_ga_emit_admission_confirmed()
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

  PERFORM public.fn_ga_relay_post(
    NEW.id,
    'admission_confirmed',
    v_value,
    -- transaction_id = lead.id so this event is dedupable in GA
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_emit_admission_confirmed ON public.leads;
CREATE TRIGGER trg_ga_emit_admission_confirmed
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ga_emit_admission_confirmed();
