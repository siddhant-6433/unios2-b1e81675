-- Database hygiene follow-up from activity-ranked catalog audits.
--
-- Covers the next tier of missing FK indexes after the high-traffic
-- leads/whatsapp/ai_call/applications pass, with emphasis on payment, offer,
-- email, and admissions-support tables that showed meaningful scan/write
-- activity. Also removes exact duplicate indexes proven equivalent by
-- pg_index catalog fields.

-- Next-tier missing FK indexes.
CREATE INDEX IF NOT EXISTS idx_apply_magic_tokens_created_by_fk
  ON public.apply_magic_tokens (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_template_id_fk
  ON public.email_messages (template_id)
  WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_sent_by_fk
  ON public.email_messages (sent_by)
  WHERE sent_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_payments_recorded_by_fk
  ON public.lead_payments (recorded_by)
  WHERE recorded_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_application_doc_reviews_reviewed_by_fk
  ON public.application_doc_reviews (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_ledger_fee_structure_item_id_fk
  ON public.fee_ledger (fee_structure_item_id)
  WHERE fee_structure_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_ledger_fee_code_id_fk
  ON public.fee_ledger (fee_code_id)
  WHERE fee_code_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_ledger_student_id_fk
  ON public.fee_ledger (student_id)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_merges_merged_by_fk
  ON public.lead_merges (merged_by)
  WHERE merged_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_merges_kept_lead_id_fk
  ON public.lead_merges (kept_lead_id)
  WHERE kept_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_courses_department_id_fk
  ON public.courses (department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_letters_issued_by_fk
  ON public.offer_letters (issued_by)
  WHERE issued_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_letters_campus_id_fk
  ON public.offer_letters (campus_id)
  WHERE campus_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_letters_lead_id_fk
  ON public.offer_letters (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_letters_course_id_fk
  ON public.offer_letters (course_id)
  WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_letters_approved_by_fk
  ON public.offer_letters (approved_by)
  WHERE approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_login_intents_user_id_fk
  ON public.whatsapp_login_intents (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_structures_session_id_fk
  ON public.fee_structures (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_waivers_requested_by_fk
  ON public.offer_waivers (requested_by)
  WHERE requested_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_waivers_approved_by_fk
  ON public.offer_waivers (approved_by)
  WHERE approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_attendance_geofence_location_id_fk
  ON public.employee_attendance (geofence_location_id)
  WHERE geofence_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_attendance_campus_id_fk
  ON public.employee_attendance (campus_id)
  WHERE campus_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_token_fee_reminders_sent_lead_id_fk
  ON public.token_fee_reminders_sent (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alumni_verification_requests_reviewed_by_fk
  ON public.alumni_verification_requests (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alumni_verification_requests_admin_approved_by_fk
  ON public.alumni_verification_requests (admin_approved_by)
  WHERE admin_approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alumni_verification_requests_employee_reviewed_by_fk
  ON public.alumni_verification_requests (employee_reviewed_by)
  WHERE employee_reviewed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id_fk
  ON public.role_permissions (permission_id)
  WHERE permission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consultant_commissions_course_id_fk
  ON public.consultant_commissions (course_id)
  WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_initiated_by_fk
  ON public.ai_call_logs (initiated_by)
  WHERE initiated_by IS NOT NULL;

-- Exact duplicate index cleanup. The kept indexes had equal definitions and
-- higher observed scan counts at audit time.
DROP INDEX IF EXISTS public.idx_call_logs_inbound_missed_lead;
DROP INDEX IF EXISTS public.idx_lead_activities_lead_created;
DROP INDEX IF EXISTS public.idx_lead_followups_pending_scheduled_lead_hot;
