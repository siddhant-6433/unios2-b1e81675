-- Make the CUET counselling template available in the lead WhatsApp picker
-- and allow template managers to upload the public image header asset.

INSERT INTO public.whatsapp_template_settings
  (template_key, display_name, description, category, show_in_lead_picker)
VALUES
  (
    'cuet_2026_counselling_open',
    'CUET 2026 Counselling Open',
    'CUET result follow-up with counselling guidance and image header.',
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

DROP POLICY IF EXISTS "Template managers upload whatsapp template assets" ON storage.objects;
CREATE POLICY "Template managers upload whatsapp template assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-media'
    AND (storage.foldername(name))[1] = 'template-assets'
    AND (
      public.has_role(auth.uid(), 'super_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
    )
  );
