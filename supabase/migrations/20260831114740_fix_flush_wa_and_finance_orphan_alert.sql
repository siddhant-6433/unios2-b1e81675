-- 1. Fix flush-scheduled-wa-sends: replace broken current_setting() with vault/_app_config pattern
SELECT cron.unschedule('flush-scheduled-wa-sends');
SELECT cron.schedule('flush-scheduled-wa-sends', '*/30 * * * *', $$
  SELECT net.http_post(
    url := coalesce(
             (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
             (SELECT value FROM public._app_config WHERE key = 'supabase_url')
           ) || '/functions/v1/whatsapp-scheduled-flush',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  )
$$);

-- 2. Widen notifications_type_check to include finance_orphan_alert
--
-- IF EXISTS matters: this migration is already applied in production, and a bare
-- DROP aborts the whole transaction if the constraint is missing (e.g. a partial
-- apply, or a re-run after the ledger drifted). Adding a notifications.type
-- without widening this CHECK silently rolls back the inserting transaction, so
-- the file has to stay safely re-runnable.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'lead_assigned','sla_warning','lead_reclaimed','followup_due','followup_overdue',
  'visit_confirmation_due','visit_followup_due','lead_transferred','deletion_request',
  'whatsapp_message','whatsapp_sla_warning','whatsapp_sla_breach',
  'approval_pending','approval_decided','template_status_update','tat_defaults_report',
  'post_visit_nudge','score_penalty','lead_bucket_backlog','feedback_received',
  'campaign_completed','student_service_assigned','student_service_unassigned',
  'pgdm_certificate_pending','pgdm_certificate_approved','pgdm_diploma_ready',
  'general','visit_due','missed_call','callback_requested','notice_published',
  'gatepass_update','assignment_due','substitution_assigned','leave_decision',
  'hostel_alert','approval_request','payment_receipt','finance_audit_anomaly',
  'partner_referral_outcome','an_pending_docs',
  'hr_document_pending','hr_document_approved','hr_document_rejected',
  'finance_orphan_alert'
]));
