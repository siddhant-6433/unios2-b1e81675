-- Sprint 3 Feature 2: Automation Rules Engine

CREATE TABLE public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'stage_change', 'activity_created', 'followup_overdue', 'time_elapsed'
  )),
  trigger_config jsonb NOT NULL DEFAULT '{}',
  actions jsonb NOT NULL DEFAULT '[]',
  campus_id uuid REFERENCES public.campuses(id),
  priority integer DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.automation_rule_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  actions_executed jsonb NOT NULL DEFAULT '[]',
  status text DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_automation_rules_active ON public.automation_rules(is_active, trigger_type);
CREATE INDEX idx_automation_executions_rule ON public.automation_rule_executions(rule_id);
CREATE INDEX idx_automation_executions_lead ON public.automation_rule_executions(lead_id);

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage automation_rules"
  ON public.automation_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage automation_rule_executions"
  ON public.automation_rule_executions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Pre-seed useful rules (inactive by default — admin activates them)
INSERT INTO public.automation_rules (name, description, is_active, trigger_type, trigger_config, actions) VALUES
(
  'Application Submitted → WhatsApp Acknowledgement',
  'Send application received WhatsApp when application is submitted',
  false,
  'stage_change',
  '{"to_stage": "application_submitted"}',
  '[{"type": "send_whatsapp", "template_key": "application_received"}]'
),
(
  'Visit Attended → Schedule Follow-up Call',
  'Auto-schedule a follow-up call 24 hours after campus visit',
  false,
  'stage_change',
  '{"to_stage": "visit_scheduled"}',
  '[{"type": "schedule_followup", "delay_hours": 24, "followup_type": "call"}]'
),
(
  'Offer Sent, No Response 3 Days → Fee Reminder',
  'Send fee reminder WhatsApp if no activity 3 days after offer',
  false,
  'time_elapsed',
  '{"stage": "offer_sent", "elapsed_days": 3}',
  '[{"type": "send_whatsapp", "template_key": "fee_reminder"}]'
);
