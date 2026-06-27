-- Meta can return additional template lifecycle statuses during deletion or
-- appeal flows. Keep the local mirror from rejecting a valid Graph API sync.

ALTER TABLE public.whatsapp_templates
  DROP CONSTRAINT IF EXISTS whatsapp_templates_status_check;

ALTER TABLE public.whatsapp_templates
  ADD CONSTRAINT whatsapp_templates_status_check
  CHECK (status IN (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PAUSED',
    'DISABLED',
    'IN_APPEAL',
    'FLAGGED',
    'PENDING_DELETION',
    'DELETED'
  ));
