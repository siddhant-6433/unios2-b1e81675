-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260730101621 name=hr_designations applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.designations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  name           text NOT NULL,
  code           text,
  level          int,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS designations_name_uniq
  ON public.designations (lower(name), COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_designations_active
  ON public.designations (is_active, name) WHERE is_active;

DROP TRIGGER IF EXISTS update_designations_updated_at ON public.designations;
CREATE TRIGGER update_designations_updated_at
  BEFORE UPDATE ON public.designations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read designations" ON public.designations;
CREATE POLICY "Staff read designations"
  ON public.designations FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "HR manages designations" ON public.designations;
CREATE POLICY "HR manages designations"
  ON public.designations FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:employees_edit' = ANY(public.get_user_permissions(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:employees_edit' = ANY(public.get_user_permissions(auth.uid()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.designations TO authenticated;
GRANT ALL ON public.designations TO service_role;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS designation_id uuid REFERENCES public.designations(id);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_designation
  ON public.employee_profiles (designation_id) WHERE designation_id IS NOT NULL;
