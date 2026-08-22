-- Replace the boolean show_in_lead_picker with a three-value visibility column:
--   'hidden'         → not shown anywhere
--   'marketing_only' → Marketing hub + Lead Lists bulk send only
--   'all'            → Marketing hub + counsellor pickers (lead page, dialer, inbox)

ALTER TABLE public.whatsapp_template_settings
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'hidden';

UPDATE public.whatsapp_template_settings
  SET visibility = CASE WHEN show_in_lead_picker THEN 'all' ELSE 'hidden' END;

ALTER TABLE public.whatsapp_template_settings
  DROP COLUMN show_in_lead_picker;

ALTER TABLE public.whatsapp_template_settings
  ADD CONSTRAINT chk_visibility CHECK (visibility IN ('hidden', 'marketing_only', 'all'));
