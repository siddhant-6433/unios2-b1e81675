-- Store complete email texts for audit trail
ALTER TABLE public.alumni_verification_requests
  ADD COLUMN IF NOT EXISTS employee_draft_email text,
  ADD COLUMN IF NOT EXISTS sent_email_subject text,
  ADD COLUMN IF NOT EXISTS sent_email_body text;
