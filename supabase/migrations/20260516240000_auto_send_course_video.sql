-- Expand trigger_type constraint to include lead_created if not already
ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_trigger_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_type_check
  CHECK (trigger_type IN (
    'stage_change', 'activity_created', 'followup_overdue', 'time_elapsed',
    'lead_created', 'lead_assigned', 'visit_scheduled', 'visit_completed'
  ));

-- Automation rule: Send course info + video on new lead entry
INSERT INTO public.automation_rules (
  name, trigger_type, trigger_config, actions, is_active, priority
) VALUES (
  'Send Course Info Video to New Leads',
  'lead_created',
  '{"conditions": {}}',
  '[{
    "type": "send_whatsapp",
    "template_key": "course_info_video",
    "params_template": ["{{name}}", "{{course}}", "N/A", "As per university norms", "{{campus}}"]
  }]'::jsonb,
  true,
  10
);
