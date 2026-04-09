-- Add 'notification' category to email_templates
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_category_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_category_check
  CHECK (category IN ('offer_letter', 'fee_receipt', 'admission_confirmation', 'general', 'reminder', 'notification'));

-- Seed counsellor notification email templates (editable from Template Manager)
INSERT INTO public.email_templates (name, slug, subject, body_html, variables, category) VALUES
(
  'SLA Warning — First Contact',
  'counsellor-sla-warning',
  '⚠️ SLA Warning: {{lead_name}} — {{hours_remaining}}h remaining',
  '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://app.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">SLA Warning</h2><p style="color:#475569;line-height:1.6;margin:0">Hi {{counsellor_name}},</p><p style="color:#475569;line-height:1.6">Lead <strong>{{lead_name}}</strong> has not been contacted yet. You have approximately <strong>{{hours_remaining}} hour(s)</strong> remaining before this lead is returned to the bucket.</p><p style="color:#475569;line-height:1.6">Please make the first call now.</p><p style="margin-top:16px"><a href="https://app.nimt.ac.in/admissions/{{lead_id}}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View Lead</a></p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT UniOs — Admissions CRM</p></div>',
  ARRAY['counsellor_name', 'lead_name', 'hours_remaining', 'lead_id'],
  'notification'
),
(
  'Lead Reclaimed — SLA Breach',
  'counsellor-lead-reclaimed',
  '🔄 Lead Reclaimed: {{lead_name}}',
  '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://app.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">Lead Returned to Bucket</h2><p style="color:#475569;line-height:1.6;margin:0">Hi {{counsellor_name}},</p><p style="color:#475569;line-height:1.6">Lead <strong>{{lead_name}}</strong> has been returned to the unassigned bucket because first contact was not made within <strong>{{sla_hours}} hours</strong>.</p><p style="color:#475569;line-height:1.6">You can pick it up again from Lead Buckets.</p><p style="margin-top:16px"><a href="https://app.nimt.ac.in/lead-buckets" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Go to Lead Buckets</a></p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT UniOs — Admissions CRM</p></div>',
  ARRAY['counsellor_name', 'lead_name', 'sla_hours'],
  'notification'
),
(
  'Overdue Follow-up',
  'counsellor-followup-overdue',
  '⏰ Overdue Follow-up: {{lead_name}}',
  '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://app.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">Follow-up Overdue</h2><p style="color:#475569;line-height:1.6;margin:0">Hi {{counsellor_name}},</p><p style="color:#475569;line-height:1.6">A <strong>{{followup_type}}</strong> follow-up for <strong>{{lead_name}}</strong> was scheduled for {{scheduled_date}} and is now overdue.</p><p style="color:#475569;line-height:1.6">Please complete it as soon as possible.</p><p style="margin-top:16px"><a href="https://app.nimt.ac.in/admissions/{{lead_id}}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View Lead</a></p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT UniOs — Admissions CRM</p></div>',
  ARRAY['counsellor_name', 'lead_name', 'followup_type', 'scheduled_date', 'lead_id'],
  'notification'
),
(
  'Lead Reclaimed — Overdue Follow-up',
  'counsellor-followup-reclaimed',
  '🔄 Lead Reclaimed: {{lead_name}} — Overdue Follow-up',
  '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://app.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">Lead Returned to Bucket</h2><p style="color:#475569;line-height:1.6;margin:0">Hi {{counsellor_name}},</p><p style="color:#475569;line-height:1.6">Lead <strong>{{lead_name}}</strong> has been returned to the bucket because a follow-up was overdue for over 48 hours.</p><p style="color:#475569;line-height:1.6">You can pick it up again from Lead Buckets.</p><p style="margin-top:16px"><a href="https://app.nimt.ac.in/lead-buckets" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Go to Lead Buckets</a></p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT UniOs — Admissions CRM</p></div>',
  ARRAY['counsellor_name', 'lead_name'],
  'notification'
),
(
  'Visit Confirmation Call Required',
  'counsellor-visit-confirmation',
  '📍 Confirmation Call: {{lead_name}} — Visit {{visit_timing}}',
  '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://app.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">Campus Visit Confirmation Required</h2><p style="color:#475569;line-height:1.6;margin:0">Hi {{counsellor_name}},</p><p style="color:#475569;line-height:1.6">A campus visit for <strong>{{lead_name}}</strong> at <strong>{{campus_name}}</strong> is scheduled for <strong>{{visit_timing}}</strong>.</p><p style="color:#475569;line-height:1.6">Please call the student to confirm their attendance.</p><p style="margin-top:16px"><a href="https://app.nimt.ac.in/admissions/{{lead_id}}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View Lead</a></p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT UniOs — Admissions CRM</p></div>',
  ARRAY['counsellor_name', 'lead_name', 'campus_name', 'visit_timing', 'lead_id'],
  'notification'
),
(
  'Post-Visit Follow-up Needed',
  'counsellor-visit-followup',
  '📋 Follow-up Needed: {{lead_name}} — Visited {{days_since_visit}} day(s) ago',
  '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://app.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">Post-Visit Follow-up Required</h2><p style="color:#475569;line-height:1.6;margin:0">Hi {{counsellor_name}},</p><p style="color:#475569;line-height:1.6"><strong>{{lead_name}}</strong> visited <strong>{{campus_name}}</strong> {{days_since_visit}} day(s) ago, but no follow-up has been scheduled yet.</p><p style="color:#475569;line-height:1.6">Please schedule a follow-up call now to keep the lead engaged.</p><p style="margin-top:16px"><a href="https://app.nimt.ac.in/admissions/{{lead_id}}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View Lead</a></p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT UniOs — Admissions CRM</p></div>',
  ARRAY['counsellor_name', 'lead_name', 'campus_name', 'days_since_visit', 'lead_id'],
  'notification'
)
ON CONFLICT (slug) DO NOTHING;
