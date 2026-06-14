-- Seed visibility row for the CNET not-qualified BPT/BMRIT WhatsApp template.
-- The Meta template must also be approved with name:
--   cnet_not_qualified_bpt_bmrit

INSERT INTO public.whatsapp_template_settings
  (template_key, display_name, description, category, show_in_lead_picker)
VALUES
  (
    'cnet_not_qualified_bpt_bmrit',
    'CNET Not Qualified -> BPT/BMRIT',
    'Bilingual CNET result follow-up with BPT/BMRIT and CAHET instructions',
    'application',
    true
  )
ON CONFLICT (template_key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  show_in_lead_picker = true;
