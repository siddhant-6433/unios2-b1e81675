-- Multi-WABA templates. whatsapp_templates only held the main WABA's templates
-- (the sync used WHATSAPP_WABA_ID only), so other numbers' approved templates
-- (Seralis, etc.) never appeared in the picker or Template Visibility. Tag each
-- template with its WABA so whatsapp-channel-profiles-sync can pull every WABA's
-- templates. Unique key stays (name, language) — Meta template names are unique
-- per business and don't collide across these WABAs.
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS waba_id text;
