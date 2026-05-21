-- Per-template settings: which WhatsApp templates appear in the counsellor's
-- Send WhatsApp picker on lead pages, plus optional team/user scoping.
--
-- template_key is the same key used by the whatsapp-send edge function's
-- TEMPLATES map and by SendWhatsAppDialog. One row per template.
--
-- show_in_lead_picker drives the visible list in the lead-page picker.
-- allowed_team_ids / allowed_user_ids are optional scoping arrays:
--   - NULL or empty array → all teams / users see this template
--   - non-empty array     → only those team/user ids see it
-- The two arrays AND together.

CREATE TABLE IF NOT EXISTS public.whatsapp_template_settings (
  template_key        text PRIMARY KEY,
  display_name        text NOT NULL,
  description         text,
  category            text DEFAULT 'general',
  show_in_lead_picker boolean NOT NULL DEFAULT true,
  allowed_team_ids    uuid[] DEFAULT NULL,
  allowed_user_ids    uuid[] DEFAULT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_template_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read (the lead-page picker needs to query this).
CREATE POLICY "Authenticated can read whatsapp_template_settings"
  ON public.whatsapp_template_settings
  FOR SELECT TO authenticated USING (true);

-- Admins / admission_head can write.
CREATE POLICY "Admins can manage whatsapp_template_settings"
  ON public.whatsapp_template_settings
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role)
  );

CREATE TRIGGER trg_whatsapp_template_settings_updated_at
  BEFORE UPDATE ON public.whatsapp_template_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT ON public.whatsapp_template_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.whatsapp_template_settings TO authenticated;

-- Seed with every template_key the lead-page SendWhatsAppDialog currently
-- supports. New templates inherit show_in_lead_picker=true unless an admin
-- toggles them off.
INSERT INTO public.whatsapp_template_settings (template_key, display_name, description, category, show_in_lead_picker) VALUES
  ('lead_welcome',         'Lead Welcome',          'Welcome message with course info',                'lifecycle',  true),
  ('course_info_v1',       'Course Info (smart)',   'Per-course duration / eligibility / accreditation, resolved from DB', 'course', true),
  ('course_info_video',    'Course Info + Video',   'Course details + campus video follow-up',         'course',     true),
  ('course_details',       'Course Details',        'Simple course info message',                       'course',     true),
  ('visit_confirmation',   'Visit Confirmation',    'Confirm scheduled campus visit',                   'visit',      true),
  ('visit_reminder_24hr',  'Visit Reminder (24h)',  'Day-before campus visit reminder',                 'visit',      true),
  ('visit_reminder_v2',    'Visit Reminder (v2)',   'Visit reminder with counsellor name + course',    'visit',      true),
  ('application_received', 'Application Received',  'Application submission acknowledgement',           'application',true),
  ('fee_reminder',         'Fee Reminder',          'Pending fee payment nudge',                        'finance',    true),
  ('student_welcome',      'Student Welcome',       'Welcome on admission (PAN/AN issued)',             'lifecycle',  true),
  ('applicant_welcome',    'Applicant Welcome',     'Welcome when application starts',                  'lifecycle',  true),
  ('apply_portal_login',   'Apply Portal Login',    'Magic-link to apply portal',                       'lifecycle',  true),
  ('offer_letter_acceptance','Offer Letter',        'Auto-sent on offer issuance',                      'lifecycle',  false),
  ('kb_placements',        'Placements & Packages', 'Knowledge-base placement highlights',              'knowledge',  true),
  ('kb_internships',       'Internships',           'Knowledge-base paid internship details',           'knowledge',  true),
  ('kb_rankings',          'Rankings & Recognition','Knowledge-base rankings + approvals',              'knowledge',  true),
  -- Auto-fired (not for the picker by default)
  ('missed_call',          'Missed-call note',      'Auto-fired on not_answered / busy disposition',   'auto',       false),
  ('callback_scheduled',   'Callback ack',          'Auto-fired on call_back disposition (legacy)',     'auto',       false),
  ('nimt_followup_v1',     'Follow-up + Signature', 'Personal callback note with counsellor sign-off — auto-sent on interested / call_back', 'auto', false),
  ('nimt_not_interested_ack','Not Interested Ack',  'Personal closure note — manual disposition only', 'auto',       false),
  ('counsellor_call_lead', 'Tap-to-call (counsellor)','Internal — to counsellor with tap-to-call link', 'internal',   false),
  ('counsellor_lead_assigned','Lead Assigned',      'Internal — counsellor SLA notification',           'internal',   false),
  ('counsellor_sla_warning', 'SLA Warning',         'Internal — SLA breach warning',                    'internal',   false),
  ('counsellor_lead_reclaimed','Lead Reclaimed',    'Internal — lead reclaim notice',                   'internal',   false),
  ('counsellor_visit_confirmation','Visit Confirmation (counsellor)','Internal — confirm visit',       'internal',   false),
  ('counsellor_followup_overdue','Followup Overdue','Internal — overdue followup',                      'internal',   false)
ON CONFLICT (template_key) DO NOTHING;

COMMENT ON TABLE public.whatsapp_template_settings IS
  'Per-template visibility + scoping for the lead-page Send WhatsApp picker. template_key matches whatsapp-send edge fn TEMPLATES.';
