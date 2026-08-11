-- Fix: notifications_type_check rejected 'an_pending_docs'.
--
-- Migration 20260810112955_gate_an_on_mandatory_docs added
-- notify_pending_an_generation(), which inserts notifications of
-- type 'an_pending_docs', but never widened notifications_type_check to
-- allow it. Because that notify runs inside recompute_lead_fee_stage(),
-- ANY transaction that recomputes a paid-with-pending-docs lead's stage
-- (fee payment, offer approval, offer-letter-edit approval) hit
-- "new row for relation notifications violates check constraint
-- notifications_type_check" and rolled back entirely.
--
-- Rebuild the constraint with the full current allow-list plus the
-- missing value. Idempotent (DROP IF EXISTS + ADD).

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
