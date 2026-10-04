-- dpharma last chance template
-- Curate the bilingual admission notice; Meta approval is required before sending.
INSERT INTO public.whatsapp_template_settings
  (template_key, display_name, description, category, visibility)
VALUES
  (
    'dpharma_last_chance_2026_28',
    'DPharma Last Chance 2026–28',
    'Hindi and English DPharma admission notice for JEECUP candidates, college code 1268',
    'application',
    'all'
  )
ON CONFLICT (template_key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  visibility = EXCLUDED.visibility;
