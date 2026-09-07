-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260814162711 name=hire_pipeline applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.job_openings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL,
  title                text NOT NULL,
  designation_id       uuid REFERENCES public.designations(id),
  department_id        uuid REFERENCES public.departments(id),
  campus_id            uuid REFERENCES public.campuses(id),
  description          text,
  employment_type      text NOT NULL DEFAULT 'Full Time',
  experience_min_years numeric,
  experience_max_years numeric,
  salary_min           numeric,
  salary_max           numeric,
  salary_visible       boolean NOT NULL DEFAULT false,
  location             text,
  openings_count       integer NOT NULL DEFAULT 1,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  naukri_url           text,
  posted_at            timestamptz,
  closes_at            timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_applicants DROP CONSTRAINT IF EXISTS job_applicants_status_check;
ALTER TABLE public.job_applicants
  ADD CONSTRAINT job_applicants_status_check
  CHECK (status IN ('new','reviewing','shortlisted','interview','offered','rejected','hired','withdrawn'));

ALTER TABLE public.job_applicants
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS rating smallint CHECK (rating BETWEEN 1 AND 5);

CREATE OR REPLACE FUNCTION public.touch_job_applicant_stage()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_applicants_stage_stamp ON public.job_applicants;
CREATE TRIGGER job_applicants_stage_stamp
  BEFORE UPDATE OF status ON public.job_applicants
  FOR EACH ROW EXECUTE FUNCTION public.touch_job_applicant_stage();

CREATE TABLE IF NOT EXISTS public.job_applicant_activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES public.job_applicants(id) ON DELETE CASCADE,
  user_id      uuid,
  type         text NOT NULL DEFAULT 'note',
  description  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_applicant_activities_applicant_idx
  ON public.job_applicant_activities (applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.interview_rounds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id  uuid NOT NULL REFERENCES public.job_applicants(id) ON DELETE CASCADE,
  round_name    text NOT NULL,
  round_number  smallint NOT NULL DEFAULT 1,
  scheduled_at  timestamptz,
  duration_mins smallint NOT NULL DEFAULT 30,
  mode          text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person','phone','video')),
  location      text,
  panel         uuid[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  result        text CHECK (result IN ('pass','fail','hold')),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_rounds_applicant_idx ON public.interview_rounds (applicant_id, round_number);
CREATE INDEX IF NOT EXISTS interview_rounds_upcoming_idx ON public.interview_rounds (scheduled_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS public.interview_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   uuid NOT NULL REFERENCES public.interview_rounds(id) ON DELETE CASCADE,
  panelist   uuid NOT NULL,
  rating     smallint CHECK (rating BETWEEN 1 AND 5),
  recommend  text CHECK (recommend IN ('strong_yes','yes','no','strong_no')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, panelist)
);

ALTER TABLE public.job_openings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applicant_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_rounds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_feedback       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_applicant_activities','interview_rounds','interview_feedback'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "HR reads %1$s" ON public.%1$I', t);
    EXECUTE format($p$CREATE POLICY "HR reads %1$s" ON public.%1$I FOR SELECT TO authenticated
                      USING ('hr:view' = ANY (public.get_user_permissions(auth.uid())))$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS "HR writes %1$s" ON public.%1$I', t);
    EXECUTE format($p$CREATE POLICY "HR writes %1$s" ON public.%1$I FOR ALL TO authenticated
                      USING (public.has_role(auth.uid(), 'super_admin')
                             OR 'hr:recruitment_edit' = ANY (public.get_user_permissions(auth.uid())))
                      WITH CHECK (public.has_role(auth.uid(), 'super_admin')
                             OR 'hr:recruitment_edit' = ANY (public.get_user_permissions(auth.uid())))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%1$I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%1$I TO service_role', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Public reads open job openings" ON public.job_openings;
CREATE POLICY "Public reads open job openings" ON public.job_openings FOR SELECT
  USING (status = 'open' AND (closes_at IS NULL OR closes_at > now()));

DROP POLICY IF EXISTS "Staff read all job openings" ON public.job_openings;
CREATE POLICY "Staff read all job openings" ON public.job_openings FOR SELECT TO authenticated
  USING ('hr:view' = ANY (public.get_user_permissions(auth.uid())));

DROP POLICY IF EXISTS "HR manages job openings" ON public.job_openings;
CREATE POLICY "HR manages job openings" ON public.job_openings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')
         OR 'hr:recruitment_edit' = ANY (public.get_user_permissions(auth.uid())))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin')
         OR 'hr:recruitment_edit' = ANY (public.get_user_permissions(auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_openings TO authenticated;
GRANT ALL ON public.job_openings TO service_role;

CREATE OR REPLACE FUNCTION public.hire_job_applicant(
  _applicant_id uuid, _joining_date date DEFAULT NULL, _ctc_annual numeric DEFAULT NULL,
  _job_title text DEFAULT NULL, _department_id uuid DEFAULT NULL, _campus_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_app      public.job_applicants%ROWTYPE;
  v_employee uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_app FROM public.job_applicants WHERE id = _applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such applicant'; END IF;

  SELECT id INTO v_employee FROM public.employee_profiles WHERE job_applicant_id = _applicant_id;

  IF v_employee IS NULL THEN
    INSERT INTO public.employee_profiles (
      display_name, first_name, last_name, mobile_number, personal_email,
      job_title, department_id, campus_id, date_of_joining,
      job_applicant_id, onboarding_stage, employment_status, verification_status
    ) VALUES (
      v_app.name,
      split_part(COALESCE(v_app.name, ''), ' ', 1),
      NULLIF(regexp_replace(COALESCE(v_app.name, ''), '^\S+\s*', ''), ''),
      v_app.source_phone, v_app.email,
      COALESCE(_job_title, v_app.desired_role),
      _department_id, _campus_id, _joining_date,
      _applicant_id, 'offer_accepted', 'Working', 'pending'
    ) RETURNING id INTO v_employee;
  END IF;

  UPDATE public.employee_profiles
     SET offer_joining_date = COALESCE(_joining_date, offer_joining_date),
         offer_ctc_annual   = COALESCE(_ctc_annual, offer_ctc_annual),
         offer_accepted_at  = COALESCE(offer_accepted_at, now()),
         updated_at         = now()
   WHERE id = v_employee;

  UPDATE public.job_applicants SET status = 'hired', updated_at = now() WHERE id = _applicant_id;

  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (_applicant_id, auth.uid(), 'stage',
          'Hired — employee record created. Verify the record and link a login to complete onboarding.');

  RETURN v_employee;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hire_job_applicant(uuid, date, numeric, text, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.hire_job_applicant(uuid, date, numeric, text, uuid, uuid) IS
  'The exit from the hiring pipeline: creates the employee_profiles row for an applicant and marks them hired. Idempotent on job_applicant_id.';
