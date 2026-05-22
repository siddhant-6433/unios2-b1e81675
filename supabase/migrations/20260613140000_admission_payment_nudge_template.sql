-- Seed visibility row for the admission_payment_nudge WhatsApp template
-- used by the Applications-list Nudge button (NudgePaymentDialog).
--
-- IMPORTANT: this only registers the template in our settings table so it
-- shows up in the lead-page picker. The actual Meta template MUST be
-- approved separately in Meta WhatsApp Business Manager with template name
-- `admission_payment_nudge` and these 5 body parameters in order:
--   {{1}} student_name
--   {{2}} course_name
--   {{3}} an_amount      — formatted INR string, e.g. "12,500"
--   {{4}} year1_amount   — formatted INR string, e.g. "1,38,500"
--   {{5}} due_date       — formatted date, e.g. "15 June 2026"
-- Suggested category: UTILITY. Until Meta approves it, the send will return
-- the standard "template not approved" error from the Cloud API.

INSERT INTO public.whatsapp_template_settings
  (template_key, display_name, description, category, show_in_lead_picker)
VALUES
  (
    'admission_payment_nudge',
    'Admission Payment Nudge',
    'Reminds an offer-stage candidate to pay AN balance now and clear Sem 1 fee before the configured due date.',
    'finance',
    true
  )
ON CONFLICT (template_key) DO NOTHING;
