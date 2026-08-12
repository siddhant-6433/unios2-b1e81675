-- A sendable media URL per template.
--
-- 11 of the 25 curated templates carry an IMAGE/VIDEO/DOCUMENT header, and Meta
-- requires that media on every send. The URL Meta stores in the template
-- (`example.header_handle`, a scontent.whatsapp.net link) is NOT usable as a
-- send-time link — it comes back 131053 "Media upload error … 403 Forbidden".
--
-- Until now the sendable URLs lived in two hardcoded, already-diverged
-- KNOWN_TEMPLATE_MEDIA maps in the frontend and whatsapp-campaign-send, keyed by
-- a handful of template names. Anything not in those maps went out with no
-- header at all and failed with 131008. That is why the Clinical Training /
-- Placement Report template appeared unavailable: approved, but unsendable.
--
-- Putting it on the settings row means an admin can attach media from the
-- Template Manager instead of shipping a code change per template.

ALTER TABLE public.whatsapp_template_settings
  ADD COLUMN IF NOT EXISTS media_url text;

COMMENT ON COLUMN public.whatsapp_template_settings.media_url IS
  'Publicly reachable URL for this template''s header media (image/video/document). Required for templates whose header_format is not NONE/TEXT. Must NOT be a scontent.whatsapp.net handle — Meta rejects those at send time with 131053.';

-- Seed the URLs already hardcoded in the frontend + campaign-send, so the two
-- maps can stop being the source of truth.
UPDATE public.whatsapp_template_settings SET media_url =
  'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-assets/cuet_2026_counselling_open.jpeg'
WHERE template_key IN ('cuet_2026_counselling_open', 'cuet_counselling_booking')
  AND media_url IS NULL;

UPDATE public.whatsapp_template_settings SET media_url =
  'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-assets/boarding_school_parent_interaction_header.png'
WHERE template_key = 'parent_interaction_boarding_july18'
  AND media_url IS NULL;

-- The Clinical Training, Internship & Placement Report (AY 2025-26). The PDF
-- only existed inside Meta's approved template, so it was recovered from the
-- template's header_handle and re-hosted in the public whatsapp-media bucket.
UPDATE public.whatsapp_template_settings SET media_url =
  'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-assets/placement_report_2025_26.pdf'
WHERE template_key = 'placement_report_download'
  AND media_url IS NULL;

-- Requested by admissions: make the placement/clinical-training report sendable
-- from the lead page, cloud dialer and WhatsApp inbox.
INSERT INTO public.whatsapp_template_settings (template_key, display_name, description, category, show_in_lead_picker)
VALUES (
  'placement_report_download',
  'Clinical Training & Placement Report',
  'Sends the Clinical Training, Internship & Placement Report (2025-26) PDF.',
  'general',
  true
)
ON CONFLICT (template_key) DO UPDATE
  SET show_in_lead_picker = true,
      display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description,
      updated_at   = now();
