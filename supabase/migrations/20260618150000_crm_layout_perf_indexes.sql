-- CRM layout performance indexes.
--
-- These support app-wide header/sidebar/action-bar counts that run on most CRM
-- pages. They are index-only changes: no RLS policies, grants, or SECURITY
-- DEFINER functions are changed.

CREATE INDEX IF NOT EXISTS idx_lead_activities_call_created_lead
  ON public.lead_activities (created_at, lead_id)
  WHERE type = 'call';

CREATE INDEX IF NOT EXISTS idx_lead_followups_pending_scheduled_lead
  ON public.lead_followups (scheduled_at, lead_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_call_logs_inbound_missed_lead
  ON public.call_logs (lead_id)
  WHERE direction = 'inbound' AND disposition = 'missed';

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unread_lead
  ON public.whatsapp_messages (lead_id)
  WHERE direction = 'inbound' AND is_read = false;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_pending_followup_lead
  ON public.ai_call_records (lead_id)
  WHERE needs_followup = true AND followup_done_at IS NULL;
