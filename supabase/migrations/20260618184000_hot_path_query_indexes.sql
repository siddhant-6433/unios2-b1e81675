-- Targeted read-path indexes for counsellor/admissions hot paths.
-- These support the new RPC payloads and existing dashboard/sidebar counts.
-- Keep them partial where possible to limit write amplification.

CREATE INDEX IF NOT EXISTS idx_lead_followups_pending_scheduled_lead
  ON public.lead_followups (scheduled_at, lead_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_campus_visits_status_date_lead
  ON public.campus_visits (status, visit_date, lead_id);

CREATE INDEX IF NOT EXISTS idx_call_logs_missed_inbound_lead
  ON public.call_logs (lead_id)
  WHERE direction = 'inbound' AND disposition = 'missed';

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unread_lead
  ON public.whatsapp_messages (lead_id)
  WHERE direction = 'inbound' AND is_read = false;

CREATE INDEX IF NOT EXISTS idx_leads_new_uncontacted_counsellor_created
  ON public.leads (counsellor_id, created_at)
  WHERE stage = 'new_lead' AND first_contact_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_priority_interested_counsellor
  ON public.leads (counsellor_id)
  WHERE stage = 'priority_interested';
