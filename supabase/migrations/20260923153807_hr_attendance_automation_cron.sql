-- HR automation: schedule the maintenance jobs that already existed as code but
-- were never called, and add document-expiry / probation reminders.
--
-- Before this migration `auto_punch_out()` and `close_due_employee_exits()`
-- existed but no pg_cron job invoked them, so open punches never closed and
-- exits never completed. Leave accrual also had no scheduler.

-- ── Notification types ──────────────────────────────────────────────────────
-- Widen once, cumulatively, for every HR notification this change set adds
-- (automation + expenses + performance + engagement). Later HR migrations only
-- insert; they do not touch this constraint again.

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
  'finance_orphan_alert',
  'hr_document_expiring','hr_probation_due',
  'expense_submitted','expense_decided','expense_paid','payslip_ready',
  'announcement_published','interview_scheduled',
  'helpdesk_ticket','helpdesk_reply','performance_review','recognition'
]));

-- ── Reminder workers ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_notify_document_expiry()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT
    e.user_id,
    'hr_document_expiring',
    'Document expiring: ' || d.file_name,
    d.file_name || ' expires on ' || to_char(d.expires_on, 'DD Mon YYYY') || '. Please upload a renewed copy.',
    '/my-hr'
  FROM public.employee_documents d
  JOIN public.employee_profiles e ON e.id = d.employee_id
  WHERE d.expires_on IS NOT NULL
    AND d.status <> 'rejected'
    AND e.user_id IS NOT NULL
    AND (d.expires_on - current_date) IN (30, 14, 7, 1);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_notify_probation_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT
    ur.user_id,
    'hr_probation_due',
    'Probation ending: ' || COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))),
    'Probation ends on ' || to_char(e.probation_end_date, 'DD Mon YYYY') || '. Confirm or extend it.',
    '/hr-directory'
  FROM public.employee_profiles e
  JOIN public.user_roles ur
    ON ur.role IN ('super_admin'::public.app_role, 'hr_executive'::public.app_role, 'campus_admin'::public.app_role)
  WHERE e.probation_status = 'on_probation'
    AND e.probation_end_date IS NOT NULL
    AND (e.probation_end_date - current_date) IN (7, 3, 1);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_notify_document_expiry() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_notify_probation_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_notify_document_expiry() TO service_role;
GRANT EXECUTE ON FUNCTION public.hr_notify_probation_due() TO service_role;

-- ── Schedules ───────────────────────────────────────────────────────────────
-- All times UTC (IST = UTC+5:30).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hr-auto-punch-out') THEN
    PERFORM cron.unschedule('hr-auto-punch-out');
  END IF;
  -- 19:00 IST — closes punches left open past the end of day.
  PERFORM cron.schedule('hr-auto-punch-out', '30 13 * * *',
    $$SELECT public.auto_punch_out()$$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hr-close-due-exits') THEN
    PERFORM cron.unschedule('hr-close-due-exits');
  END IF;
  -- 19:30 IST — completes exits whose last working day has passed.
  PERFORM cron.schedule('hr-close-due-exits', '0 14 * * *',
    $$SELECT public.close_due_employee_exits_internal()$$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hr-leave-accrual') THEN
    PERFORM cron.unschedule('hr-leave-accrual');
  END IF;
  -- 00:20 IST on the 1st — monthly accrual + carry-forward top-up.
  PERFORM cron.schedule('hr-leave-accrual', '20 18 1 * *',
    $$SELECT public.run_leave_accrual()$$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hr-doc-expiry-reminders') THEN
    PERFORM cron.unschedule('hr-doc-expiry-reminders');
  END IF;
  PERFORM cron.schedule('hr-doc-expiry-reminders', '0 3 * * *',
    $$SELECT public.hr_notify_document_expiry()$$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hr-probation-reminders') THEN
    PERFORM cron.unschedule('hr-probation-reminders');
  END IF;
  PERFORM cron.schedule('hr-probation-reminders', '5 3 * * *',
    $$SELECT public.hr_notify_probation_due()$$);
END;
$$;
