-- Add whatsapp_message notification type
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned', 'sla_warning', 'lead_reclaimed',
  'followup_due', 'followup_overdue', 'visit_confirmation_due',
  'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
  'whatsapp_message'
));

-- Allow authenticated users to delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Grant DELETE to authenticated role
GRANT DELETE ON public.notifications TO authenticated;
