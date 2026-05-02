-- Expand person_role to support non-admission categories
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_person_role_check;
ALTER TABLE leads ADD CONSTRAINT leads_person_role_check
  CHECK (person_role IN ('lead', 'applicant', 'student', 'alumni', 'job_applicant', 'vendor', 'other'));
