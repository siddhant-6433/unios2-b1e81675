-- Make the approved Meta template visible in manual lead and list WhatsApp
-- pickers. Meta template id: 1330123838631682.

INSERT INTO public.whatsapp_template_settings
  (template_key, display_name, description, category, show_in_lead_picker)
VALUES
  (
    'cuet_counselling_booking',
    'CUET Counselling Booking',
    'CUET counselling booking template approved in Meta.',
    'marketing',
    true
  )
ON CONFLICT (template_key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  show_in_lead_picker = true,
  updated_at = now();

UPDATE public.whatsapp_templates
SET
  meta_template_id = COALESCE(meta_template_id, '1330123838631682'),
  status = 'APPROVED',
  status_updated_at = COALESCE(status_updated_at, now()),
  updated_at = now()
WHERE name = 'cuet_counselling_booking';
