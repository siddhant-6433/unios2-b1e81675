-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260730101636 name=hr_job_openings applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.job_openings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  title                text NOT NULL,
  designation_id       uuid REFERENCES public.designations(id),
  department_id        uuid REFERENCES public.departments(id),
  campus_id            uuid REFERENCES public.campuses(id),
  description          text,
  employment_type      text NOT NULL DEFAULT 'Full Time',
  experience_min_years numeric,
  experience_max_years numeric,
  salary_min           numeric(12,2),
  salary_max           numeric(12,2),
  salary_visible       boolean NOT NULL DEFAULT false,
  location             text,
  openings_count       int NOT NULL DEFAULT 1,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  naukri_url           text,
  posted_at            timestamptz,
  closes_at            timestamptz,
  created_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_openings_open
  ON public.job_openings (status, posted_at DESC) WHERE status = 'open';

DROP TRIGGER IF EXISTS update_job_openings_updated_at ON public.job_openings;
CREATE TRIGGER update_job_openings_updated_at
  BEFORE UPDATE ON public.job_openings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.job_openings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads open job openings" ON public.job_openings;
CREATE POLICY "Public reads open job openings"
  ON public.job_openings FOR SELECT TO anon, authenticated
  USING (status = 'open' AND (closes_at IS NULL OR closes_at > now()));

DROP POLICY IF EXISTS "Staff read all job openings" ON public.job_openings;
CREATE POLICY "Staff read all job openings"
  ON public.job_openings FOR SELECT TO authenticated
  USING ('hr:view' = ANY(public.get_user_permissions(auth.uid())));

DROP POLICY IF EXISTS "HR manages job openings" ON public.job_openings;
CREATE POLICY "HR manages job openings"
  ON public.job_openings FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:recruitment_edit' = ANY(public.get_user_permissions(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:recruitment_edit' = ANY(public.get_user_permissions(auth.uid()))
  );

GRANT SELECT ON public.job_openings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_openings TO authenticated;
GRANT ALL ON public.job_openings TO service_role;
