-- Add 'missed_call' to notification type constraint for inbound call system
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned', 'sla_warning', 'lead_reclaimed',
  'followup_due', 'followup_overdue', 'visit_confirmation_due',
  'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
  'whatsapp_message', 'approval_pending', 'approval_decided',
  'missed_call'
));
