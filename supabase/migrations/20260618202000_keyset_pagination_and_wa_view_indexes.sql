-- Keyset/list hot-path indexes.
--
-- Supports:
-- - Admissions / call-log list pagination by created_at DESC.
-- - whatsapp_conversations, which is a view over whatsapp_messages with
--   DISTINCT latest-message lookup plus per-phone lateral counts.
--
-- Index-only migration: no RLS, grants, or view/function contracts change.

CREATE INDEX IF NOT EXISTS idx_leads_created_id_desc
  ON public.leads (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_leads_source_created_id_desc
  ON public.leads (source, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_created_id_desc
  ON public.call_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_user_created_id_desc
  ON public.call_logs (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_call_records_created_id_desc
  ON public.ai_call_records (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_call_records_stats_created
  ON public.ai_call_records (created_at)
  WHERE status <> 'counsellor_no_answer';

CREATE INDEX IF NOT EXISTS idx_ai_call_records_call_type_created_id_desc
  ON public.ai_call_records (call_type, created_at DESC, id DESC)
  WHERE status <> 'counsellor_no_answer';

CREATE INDEX IF NOT EXISTS idx_lead_followups_pending_scheduled_lead_hot
  ON public.lead_followups (scheduled_at, lead_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_lead_followups_completed_lead_completed_at
  ON public.lead_followups (lead_id, completed_at)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_campus_visits_completed_visit_date_lead
  ON public.campus_visits (visit_date, lead_id)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_call_logs_lead_called_at_exists
  ON public.call_logs (lead_id, called_at)
  WHERE called_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation_latest
  ON public.whatsapp_messages (phone, COALESCE(business_phone_number_id, ''), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation_unread
  ON public.whatsapp_messages (phone, COALESCE(business_phone_number_id, ''))
  WHERE direction = 'inbound' AND is_read = false;

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation_inbound
  ON public.whatsapp_messages (phone, COALESCE(business_phone_number_id, ''))
  WHERE direction = 'inbound';

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation_leads
  ON public.whatsapp_messages (phone, COALESCE(business_phone_number_id, ''), lead_id)
  WHERE lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ai_call_log_stats(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*)::integer,
    'completed', COUNT(*) FILTER (WHERE status = 'completed')::integer,
    'withRecording', COUNT(*) FILTER (WHERE recording_url IS NOT NULL)::integer,
    'highConv', COUNT(*) FILTER (WHERE COALESCE(conversion_probability, 0) >= 60)::integer,
    'inbound', COUNT(*) FILTER (WHERE call_type = 'inbound')::integer
  )
  FROM public.ai_call_records
  WHERE status <> 'counsellor_no_answer'
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to);
$$;

GRANT EXECUTE ON FUNCTION public.ai_call_log_stats(timestamptz, timestamptz) TO authenticated;
