-- Auto-trigger AI voice call when a new lead is created.
-- Skips if lead has skip_ai_call = true (set by bulk imports).
-- Uses pg_net to call the voice-call edge function asynchronously.

-- Add skip flag column
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS skip_ai_call boolean DEFAULT false;

-- Trigger function
CREATE OR REPLACE FUNCTION public.fn_auto_ai_call_on_lead_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Skip if flagged (bulk imports set this to true)
  IF NEW.skip_ai_call = true THEN
    RETURN NEW;
  END IF;

  -- Skip if no phone number
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    RETURN NEW;
  END IF;

  -- Get config
  SELECT value INTO v_url FROM _app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM _app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire AI call asynchronously via pg_net (non-blocking)
  PERFORM net.http_post(
    url := v_url || '/functions/v1/voice-call',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'action', 'outbound',
      'lead_id', NEW.id
    )
  );

  -- Also fire automation engine for lead_created
  PERFORM net.http_post(
    url := v_url || '/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'trigger_type', 'lead_created',
      'lead_id', NEW.id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block lead creation if AI call fails
  RAISE WARNING 'Auto AI call trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_ai_call_on_lead_create ON public.leads;
CREATE TRIGGER trg_auto_ai_call_on_lead_create
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_ai_call_on_lead_create();
