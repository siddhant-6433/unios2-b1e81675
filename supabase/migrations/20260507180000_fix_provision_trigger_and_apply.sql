-- ============================================================
-- Fix: empty fee ledger after admission
--
-- Two issues observed for AN-F8B318AF (Diya Sharma):
--   • Her ledger was empty even though she has an approved offer letter
--     (₹2,63,900) with two approved year-1 waivers (₹1,29,000 total) and
--     a confirmed token-fee payment (₹5,000).
--   • The provision-student-fees edge function already understands waivers
--     and token credits, but the trigger calling it only fires on
--     `AFTER UPDATE OF admission_no`. Many code paths set the admission_no
--     in the INSERT itself (or via copy-from-lead flow), so the trigger
--     never ran for these students and no ledger rows were created.
--
-- Fix:
--   1. Trigger fires on INSERT OR UPDATE of admission_no.
--   2. Trigger function tolerates the INSERT case (OLD is null) and only
--      skips when admission_no didn't change on UPDATE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_provision_fees_on_admission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url  text;
  v_key  text;
BEGIN
  IF NEW.admission_no IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only fire when the admission_no actually changed.
  IF TG_OP = 'UPDATE' AND OLD.admission_no IS NOT DISTINCT FROM NEW.admission_no THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[auto_provision_fees] _app_config missing supabase_url or service_role_key; skipping for student %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/provision-student-fees',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('student_id', NEW.id)::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_provision_fees_on_admission ON public.students;
CREATE TRIGGER trg_auto_provision_fees_on_admission
  AFTER INSERT OR UPDATE OF admission_no ON public.students
  FOR EACH ROW
  WHEN (NEW.admission_no IS NOT NULL)
  EXECUTE FUNCTION public.auto_provision_fees_on_admission();
