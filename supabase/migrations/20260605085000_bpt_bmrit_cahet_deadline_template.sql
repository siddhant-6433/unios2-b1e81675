-- Seed visibility row for the BPT/BMRIT CAHET deadline WhatsApp template.
-- The Meta template must also be approved with name:
--   bpt_bmrit_cahet_deadline

INSERT INTO public.whatsapp_template_settings
  (template_key, display_name, description, category, show_in_lead_picker)
VALUES
  (
    'bpt_bmrit_cahet_deadline',
    'BPT/BMRIT CAHET Deadline',
    '5 June 2026 application + CAHET registration deadline',
    'application',
    true
  )
ON CONFLICT (template_key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  show_in_lead_picker = true;
