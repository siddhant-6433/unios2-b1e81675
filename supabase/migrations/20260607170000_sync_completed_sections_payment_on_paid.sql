-- When applications.payment_status flips to 'paid' (online gateway, manual
-- mark-paid, or any future path), automatically stamp completed_sections.payment
-- = true so the apply-portal progress stepper and student dashboard reflect the
-- payment without requiring the applicant to click "Continue" in the portal.

CREATE OR REPLACE FUNCTION public.fn_sync_payment_section_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only on the pending → paid transition.
  IF NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF OLD.payment_status = 'paid' THEN
    RETURN NEW;  -- already paid; no-op
  END IF;

  -- Merge payment: true into completed_sections (JSONB coalesce so we
  -- never lose other section flags that were already set).
  NEW.completed_sections :=
    COALESCE(NEW.completed_sections, '{}'::jsonb) || '{"payment": true}'::jsonb;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_sync_payment_section_on_paid()
  TO service_role, authenticated;

DROP TRIGGER IF EXISTS trg_sync_payment_section_on_paid ON public.applications;
CREATE TRIGGER trg_sync_payment_section_on_paid
  BEFORE UPDATE OF payment_status ON public.applications
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.fn_sync_payment_section_on_paid();

-- ── Backfill: stamp all already-paid applications ────────────────────────────
UPDATE public.applications
SET completed_sections =
      COALESCE(completed_sections, '{}'::jsonb) || '{"payment": true}'::jsonb
WHERE payment_status = 'paid'
  AND (completed_sections IS NULL
       OR (completed_sections->>'payment')::boolean IS DISTINCT FROM true);
