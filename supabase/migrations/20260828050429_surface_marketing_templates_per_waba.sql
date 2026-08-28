-- Surface each WABA's MARKETING templates in the picker. The multi-WABA sync
-- created settings rows as 'hidden'; marketing-category templates from other
-- WABAs (Seralis) should show so they can be sent. Going forward the sync sets
-- visibility by category; this backfills existing rows. Idempotent.
UPDATE public.whatsapp_template_settings s
   SET visibility = 'marketing_only'
  FROM public.whatsapp_templates t
 WHERE t.name = s.template_key
   AND t.waba_id IS NOT NULL
   AND upper(coalesce(t.category, '')) = 'MARKETING'
   AND s.visibility = 'hidden';
