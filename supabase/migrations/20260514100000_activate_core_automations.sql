-- Activate and create core automation rules for WhatsApp + follow-ups

-- 1. Activate existing rules
UPDATE public.automation_rules SET is_active = true
WHERE name IN (
  'Application Submitted → WhatsApp Acknowledgement',
  'Visit Attended → Schedule Follow-up Call'
);

-- 2. Add missing essential rules (active by default)

-- Visit Scheduled → Send WhatsApp visit confirmation
INSERT INTO public.automation_rules (name, description, is_active, trigger_type, trigger_config, actions, priority) VALUES
(
  'Visit Scheduled → WhatsApp Confirmation',
  'Send visit confirmation WhatsApp when a campus visit is scheduled (by AI call, counsellor, or manually)',
  true,
  'stage_change',
  '{"to_stage": "visit_scheduled"}',
  '[{"type": "send_whatsapp", "template_key": "visit_confirmation", "params_template": ["{{name}}", "the scheduled date", "{{campus}}"]}]',
  10
),
-- AI Call Completed → Send course info WhatsApp
(
  'AI Call → WhatsApp Course Info',
  'Send course details WhatsApp after AI call completes',
  true,
  'stage_change',
  '{"to_stage": "counsellor_call"}',
  '[{"type": "send_whatsapp", "template_key": "lead_welcome", "params_template": ["{{name}}", "{{course}}", "{{source}}"]}]',
  5
),
-- Lead Assigned → Notify counsellor on WhatsApp
(
  'Lead Assigned → WhatsApp to Counsellor',
  'Send WhatsApp notification to assigned counsellor when a lead is assigned',
  true,
  'lead_assigned',
  '{}',
  '[{"type": "create_notification", "notify_counsellor": true, "notification_type": "lead_assigned", "title": "New lead assigned: {{name}}", "body": "Make first contact within the SLA window."}]',
  10
),
-- Visit Scheduled → Schedule 24hr reminder follow-up
(
  'Visit Scheduled → 24hr Follow-up',
  'Auto-schedule a follow-up reminder 24 hours after visit is scheduled',
  true,
  'stage_change',
  '{"to_stage": "visit_scheduled"}',
  '[{"type": "schedule_followup", "delay_hours": 24, "followup_type": "call"}]',
  5
),
-- Not Interested → Log and notify
(
  'Not Interested → Notify Admin',
  'Notify admission head when a lead is marked as not interested',
  true,
  'stage_change',
  '{"to_stage": "not_interested"}',
  '[{"type": "create_notification", "notify_counsellor": true, "notification_type": "general", "title": "Lead dropped: {{name}}", "body": "Marked as not interested after {{stage}} stage."}]',
  5
)
ON CONFLICT DO NOTHING;

-- 3. Also create a trigger on leads table that fires the automation engine
-- on stage changes (currently only the voice agent calls it explicitly)

CREATE OR REPLACE FUNCTION public.fn_trigger_automation_on_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire if stage actually changed
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    -- Call automation engine asynchronously via pg_net if available,
    -- otherwise use a simple HTTP call via the Supabase Edge Function
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/automation-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'trigger_type', 'stage_change',
        'lead_id', NEW.id,
        'old_stage', OLD.stage::text,
        'new_stage', NEW.stage::text
      )
    );
  END IF;

  -- Also fire on counsellor assignment
  IF OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id AND NEW.counsellor_id IS NOT NULL THEN
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/automation-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'trigger_type', 'lead_assigned',
        'lead_id', NEW.id,
        'counsellor_id', NEW.counsellor_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block the update if automation fails
  RAISE WARNING 'Automation trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Check if pg_net extension is available (Supabase has it)
CREATE EXTENSION IF NOT EXISTS pg_net;

DROP TRIGGER IF EXISTS trg_automation_stage_change ON public.leads;
CREATE TRIGGER trg_automation_stage_change
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trigger_automation_on_stage_change();
