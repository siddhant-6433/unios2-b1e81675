-- mirai application started activity
-- Applicant sessions use the anon role and cannot insert into lead_activities.
-- Preserve the existing Mirai application-start event inside the database after
-- the application trigger has resolved its lead.
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_type_check CHECK (type IN (
    'note', 'call', 'whatsapp', 'email', 'visit', 'visit_completed',
    'status_change', 'stage_change', 'system', 'lead_created', 'ai_call',
    'followup', 'offer', 'interview', 'conversion', 'application_progress',
    'application_started', 'info_update', 'assignment'
  ));

CREATE OR REPLACE FUNCTION public.fn_mirai_application_started_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL
     AND 'portal:mirai' = ANY(COALESCE(NEW.flags, ARRAY[]::text[])) THEN
    INSERT INTO public.lead_activities (lead_id, type, description, old_stage, new_stage)
    VALUES (
      NEW.lead_id,
      'application_started',
      format('Application %s started with %s course(s)', NEW.application_id, jsonb_array_length(COALESCE(NEW.course_selections, '[]'::jsonb))),
      'new_lead',
      'application_in_progress'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirai_application_started_activity ON public.applications;
CREATE TRIGGER trg_mirai_application_started_activity
  AFTER INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_mirai_application_started_activity();
