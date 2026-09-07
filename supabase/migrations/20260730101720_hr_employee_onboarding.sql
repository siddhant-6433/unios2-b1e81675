-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260730101720 name=hr_employee_onboarding applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.employee_profiles
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS onboarding_stage   text NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS offer_letter_url   text,
  ADD COLUMN IF NOT EXISTS offer_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_accepted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS offer_joining_date date,
  ADD COLUMN IF NOT EXISTS offer_ctc_annual   numeric(12,2),
  ADD COLUMN IF NOT EXISTS offer_role         public.app_role,
  ADD COLUMN IF NOT EXISTS job_applicant_id   uuid REFERENCES public.job_applicants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS keka_employee_id   text;

ALTER TABLE public.employee_profiles
  DROP CONSTRAINT IF EXISTS employee_profiles_onboarding_stage_check;
ALTER TABLE public.employee_profiles
  ADD CONSTRAINT employee_profiles_onboarding_stage_check
  CHECK (onboarding_stage IN
    ('candidate','documents','offer_generated','offer_accepted','login_created','employee'));

CREATE INDEX IF NOT EXISTS idx_employee_profiles_stage
  ON public.employee_profiles (onboarding_stage) WHERE onboarding_stage <> 'employee';

CREATE UNIQUE INDEX IF NOT EXISTS employee_profiles_keka_id_uniq
  ON public.employee_profiles (keka_employee_id) WHERE keka_employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employee_profiles_candidate_mobile_uniq
  ON public.employee_profiles (mobile_number)
  WHERE user_id IS NULL AND mobile_number IS NOT NULL;

DROP POLICY IF EXISTS "HR reads employee profiles" ON public.employee_profiles;
CREATE POLICY "HR reads employee profiles"
  ON public.employee_profiles FOR SELECT TO authenticated
  USING ('hr:view' = ANY(public.get_user_permissions(auth.uid())));

DROP POLICY IF EXISTS "HR writes employee profiles" ON public.employee_profiles;
CREATE POLICY "HR writes employee profiles"
  ON public.employee_profiles FOR ALL TO authenticated
  USING ('hr:employees_edit' = ANY(public.get_user_permissions(auth.uid())))
  WITH CHECK ('hr:employees_edit' = ANY(public.get_user_permissions(auth.uid())));

DROP POLICY IF EXISTS "Users can update own employee profile" ON public.employee_profiles;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_profiles TO authenticated;
GRANT ALL ON public.employee_profiles TO service_role;
