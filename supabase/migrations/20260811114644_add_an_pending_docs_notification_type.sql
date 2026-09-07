-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260811114644 name=add_an_pending_docs_notification_type applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'lead_assigned', 'sla_warning', 'lead_reclaimed', 'followup_due',
    'followup_overdue', 'visit_confirmation_due', 'visit_followup_due',
    'lead_transferred', 'deletion_request', 'whatsapp_message',
    'whatsapp_sla_warning', 'whatsapp_sla_breach', 'approval_pending',
    'approval_decided', 'template_status_update', 'tat_defaults_report',
    'post_visit_nudge', 'score_penalty', 'lead_bucket_backlog',
    'feedback_received', 'campaign_completed', 'student_service_assigned',
    'student_service_unassigned', 'pgdm_certificate_pending',
    'pgdm_certificate_approved', 'pgdm_diploma_ready', 'general', 'visit_due',
    'missed_call', 'callback_requested', 'notice_published', 'gatepass_update',
    'assignment_due', 'substitution_assigned', 'leave_decision', 'hostel_alert',
    'approval_request', 'payment_receipt', 'finance_audit_anomaly',
    'partner_referral_outcome', 'an_pending_docs'
  ]::text[])
);
