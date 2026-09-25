-- whatsapp web templates and toggle
-- Separate counsellor-authored WhatsApp Web messages from Meta-approved API templates.
CREATE TABLE IF NOT EXISTS public.whatsapp_web_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.whatsapp_web_config (id, enabled)
VALUES (true, true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_web_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read WhatsApp Web config" ON public.whatsapp_web_config;
CREATE POLICY "Authenticated can read WhatsApp Web config"
  ON public.whatsapp_web_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can update WhatsApp Web config" ON public.whatsapp_web_config;
CREATE POLICY "Admins can update WhatsApp Web config"
  ON public.whatsapp_web_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR public.has_role(auth.uid(), 'admission_head'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR public.has_role(auth.uid(), 'admission_head'::public.app_role));
GRANT SELECT, UPDATE ON public.whatsapp_web_config TO authenticated;

CREATE TABLE IF NOT EXISTS public.whatsapp_web_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE CHECK (template_key ~ '^[a-z0-9_]+$'),
  display_name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL,
  attachment_label text,
  attachment_url text CHECK (attachment_url IS NULL OR attachment_url ~ '^https://'),
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.whatsapp_web_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Counsellors can read active WhatsApp Web templates" ON public.whatsapp_web_templates;
CREATE POLICY "Counsellors can read active WhatsApp Web templates"
  ON public.whatsapp_web_templates FOR SELECT TO authenticated
  USING (is_active OR public.has_role(auth.uid(), 'super_admin'::public.app_role) OR public.has_role(auth.uid(), 'admission_head'::public.app_role));
DROP POLICY IF EXISTS "Admins can manage WhatsApp Web templates" ON public.whatsapp_web_templates;
CREATE POLICY "Admins can manage WhatsApp Web templates"
  ON public.whatsapp_web_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR public.has_role(auth.uid(), 'admission_head'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR public.has_role(auth.uid(), 'admission_head'::public.app_role));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_web_templates TO authenticated;

CREATE INDEX IF NOT EXISTS idx_whatsapp_web_templates_active_order
  ON public.whatsapp_web_templates (sort_order, display_name)
  WHERE is_active;

INSERT INTO public.whatsapp_web_templates
  (template_key, display_name, category, body, attachment_label, is_active, sort_order)
VALUES
  ('course_brochure', 'Course Brochure', 'course', 'Hi {{student_name}}, here is the brochure for {{course_name}} at NIMT.', 'Course brochure', false, 10),
  ('fee_structure', 'Fee Structure', 'fees', 'Hi {{student_name}}, here is the fee structure for {{course_name}} at NIMT.', 'Fee structure', false, 20)
ON CONFLICT (template_key) DO NOTHING;

COMMENT ON TABLE public.whatsapp_web_templates IS
  'Browser-only counsellor message templates; not submitted to Meta. Optional public HTTPS attachment URLs are included as clickable message links.';
COMMENT ON COLUMN public.whatsapp_web_templates.attachment_url IS
  'Public HTTPS URL included in WhatsApp Web message text. This is a clickable link, not a binary file attachment.';
