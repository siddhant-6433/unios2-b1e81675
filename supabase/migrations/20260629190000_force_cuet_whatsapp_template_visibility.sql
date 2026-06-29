-- Reassert CUET templates in the manual WhatsApp picker.
--
-- Meta sync can create newly approved templates with show_in_lead_picker=false
-- before a hand-authored migration lands. This keeps the known CUET templates
-- visible even if that happened before deployment.

INSERT INTO public.whatsapp_template_settings
  (template_key, display_name, description, category, show_in_lead_picker)
VALUES
  (
    'cuet_2026_counselling_open',
    'CUET 2026 Counselling Open',
    'CUET result follow-up with counselling guidance and image header.',
    'marketing',
    true
  ),
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
