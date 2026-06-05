-- Activity-ranked missing foreign-key indexes.
--
-- Generated from pg_stat_user_tables-ranked FK audit on the linked remote DB.
-- Skips FKs already covered by a usable left-prefix index or by a selective
-- `fk_col IS NOT NULL` partial index. These are the highest-write/high-scan
-- uncovered constraints from the corrected audit.

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_read_by_fk
  ON public.whatsapp_messages (read_by)
  WHERE read_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_assigned_to_fk
  ON public.whatsapp_messages (assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_course_id_fk
  ON public.leads (course_id)
  WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_consultant_id_fk
  ON public.leads (consultant_id)
  WHERE consultant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_quality_score_by_fk
  ON public.ai_call_records (quality_score_by)
  WHERE quality_score_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_followup_done_by_fk
  ON public.ai_call_records (followup_done_by)
  WHERE followup_done_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_initiated_by_fk
  ON public.ai_call_records (initiated_by)
  WHERE initiated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_queue_lead_id_fk
  ON public.ai_call_queue (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_queue_requested_by_fk
  ON public.ai_call_queue (requested_by)
  WHERE requested_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_lead_id_fk
  ON public.notifications (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_followups_user_id_fk
  ON public.lead_followups (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_notes_user_id_fk
  ON public.lead_notes (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_drafts_created_by_fk
  ON public.lead_drafts (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_lists_created_by_fk
  ON public.lead_lists (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_approved_by_fk
  ON public.applications (approved_by)
  WHERE approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_lead_id_fk
  ON public.applications (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_session_id_fk
  ON public.applications (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campus_visits_campus_id_fk
  ON public.campus_visits (campus_id)
  WHERE campus_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campus_visits_scheduled_by_fk
  ON public.campus_visits (scheduled_by)
  WHERE scheduled_by IS NOT NULL;
