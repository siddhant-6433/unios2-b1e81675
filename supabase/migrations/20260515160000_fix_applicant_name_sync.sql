-- Fix: Leads created via upsert_application_lead get name "Applicant" because
-- the real name isn't known until the candidate fills the form. When the
-- application's full_name is updated, sync it back to the lead.

CREATE OR REPLACE FUNCTION public.fn_sync_application_name_to_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when full_name actually changed to something non-empty
  IF NEW.full_name IS NOT NULL
    AND NEW.full_name != ''
    AND NEW.full_name != 'Applicant'
    AND (OLD.full_name IS DISTINCT FROM NEW.full_name)
    AND NEW.lead_id IS NOT NULL
  THEN
    UPDATE public.leads
    SET name = NEW.full_name,
        updated_at = now()
    WHERE id = NEW.lead_id
      AND (name IS NULL OR name = '' OR name = 'Applicant');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_app_name_to_lead ON public.applications;
CREATE TRIGGER trg_sync_app_name_to_lead
  AFTER UPDATE OF full_name ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_application_name_to_lead();

-- Backfill: update leads that still have "Applicant" as name
-- where their linked application has a real name
UPDATE public.leads l
SET name = a.full_name, updated_at = now()
FROM public.applications a
WHERE a.lead_id = l.id
  AND l.name IN ('Applicant', '')
  AND a.full_name IS NOT NULL
  AND a.full_name != ''
  AND a.full_name != 'Applicant';
