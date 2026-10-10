ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'course_not_available';

-- Course requests we cannot currently serve are terminal for normal outreach.
CREATE OR REPLACE FUNCTION public.fn_cancel_followups_on_terminal_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold', 'course_not_available')
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    UPDATE public.lead_followups
       SET status = 'cancelled', completed_at = now()
     WHERE lead_id = NEW.id
       AND status = 'pending'
       AND type <> 'cold_followup';
  END IF;
  RETURN NEW;
END;
$$;
