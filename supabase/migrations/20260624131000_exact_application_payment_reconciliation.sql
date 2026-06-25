-- Application-fee payment reconciliation hardening.
--
-- Problem: lead_payments.application_id was added after the original reverse
-- sync trigger. The trigger still selected "latest pending application for the
-- lead", which is ambiguous when a lead has multiple applications. It also did
-- not attach the payment row to the exact application before receipt
-- generation, so confirmed payments could appear in the ledger while the
-- application remained unpaid or had no fee receipt.

CREATE OR REPLACE FUNCTION public.fn_lead_payment_to_application_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id text;
  v_payment_app_id text;
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

  v_payment_app_id := NULLIF(BTRIM(NEW.application_id), '');
  IF v_payment_app_id IS NULL THEN
    SELECT (regexp_match(COALESCE(NEW.notes, ''), '(APP-[0-9]{2}-[A-Z0-9]+)'))[1]
      INTO v_payment_app_id;
  END IF;

  -- Exact match wins. A payment that names an application must never be applied
  -- to a different pending application on the same lead.
  IF v_payment_app_id IS NOT NULL THEN
    SELECT a.application_id
      INTO v_app_id
      FROM public.applications a
     WHERE a.application_id = v_payment_app_id
       AND a.lead_id = NEW.lead_id
     LIMIT 1;
  END IF;

  -- Legacy fallback only when the payment does not name an application.
  IF v_app_id IS NULL AND v_payment_app_id IS NULL THEN
    SELECT application_id
      INTO v_app_id
      FROM public.applications
     WHERE lead_id = NEW.lead_id
       AND payment_status IS DISTINCT FROM 'paid'
     ORDER BY updated_at DESC
     LIMIT 1;
  END IF;

  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.lead_payments
     SET application_id = COALESCE(application_id, v_app_id)
   WHERE id = NEW.id
     AND application_id IS NULL;

  UPDATE public.applications
     SET payment_status = 'paid',
         payment_ref    = COALESCE(payment_ref, NEW.transaction_ref, NEW.receipt_no)
   WHERE application_id = v_app_id
     AND payment_status IS DISTINCT FROM 'paid';

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

GRANT EXECUTE ON FUNCTION public.fn_lead_payment_to_application_sync() TO service_role, authenticated;

-- Historical backfill is intentionally omitted from this production hotfix.
-- Some older rows have duplicate gateway references and must be cleaned up in
-- a separate audited reconciliation pass. This migration only fixes future
-- trigger behavior so an exact application_id payment cannot be mirrored onto
-- another pending application for the same lead.
