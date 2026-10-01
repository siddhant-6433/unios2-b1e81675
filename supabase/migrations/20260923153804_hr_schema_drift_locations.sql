-- HR schema drift: restore `hr_locations`, `business_units`, and
-- `employee_profiles.hr_location_id`.
--
-- These objects are referenced by `employee_directory_card()` and the
-- `hiring_venues` view, but the migration that introduced them
-- (20260814133024_hr_locations_and_business_unit) was recorded on production
-- with no stored statements. A fresh `db push`/reset therefore breaks on the
-- dangling references. This migration re-declares them idempotently so both a
-- fresh database and the live one converge on the same shape.
--
-- Columns referenced by existing objects (must exist everywhere):
--   hr_locations: id, name, address, is_active, campus_id
-- `ALTER ... ADD COLUMN IF NOT EXISTS` is used in addition to CREATE TABLE so
-- the live table (created out-of-band) also gains any column we rely on.

CREATE TABLE IF NOT EXISTS public.business_units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  code            text,
  legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE SET NULL,
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_units
  ADD COLUMN IF NOT EXISTS code            text,
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description     text,
  ADD COLUMN IF NOT EXISTS is_active       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS business_units_name_idx
  ON public.business_units (lower(name));

CREATE TABLE IF NOT EXISTS public.hr_locations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  address          text,
  campus_id        uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  business_unit_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL,
  legal_entity_id  uuid REFERENCES public.legal_entities(id) ON DELETE SET NULL,
  timezone         text NOT NULL DEFAULT 'Asia/Kolkata',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_locations
  ADD COLUMN IF NOT EXISTS address          text,
  ADD COLUMN IF NOT EXISTS campus_id        uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legal_entity_id  uuid REFERENCES public.legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS timezone         text NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS is_active        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

-- Non-unique: production already has this table and we cannot assume its data
-- is duplicate-free, so a UNIQUE index here could abort the migration.
CREATE INDEX IF NOT EXISTS hr_locations_name_idx
  ON public.hr_locations (lower(name));
CREATE INDEX IF NOT EXISTS hr_locations_active_idx
  ON public.hr_locations (is_active, name) WHERE is_active;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS hr_location_id uuid REFERENCES public.hr_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employee_profiles_hr_location_idx
  ON public.employee_profiles (hr_location_id) WHERE hr_location_id IS NOT NULL;

-- updated_at triggers (mirror the repo convention).
CREATE OR REPLACE FUNCTION public.tg_hr_locations_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_hr_locations_touch ON public.hr_locations;
CREATE TRIGGER trg_hr_locations_touch
  BEFORE UPDATE ON public.hr_locations
  FOR EACH ROW EXECUTE FUNCTION public.tg_hr_locations_touch();

DROP TRIGGER IF EXISTS trg_business_units_touch ON public.business_units;
CREATE TRIGGER trg_business_units_touch
  BEFORE UPDATE ON public.business_units
  FOR EACH ROW EXECUTE FUNCTION public.tg_hr_locations_touch();

-- RLS: everyone on staff may read locations (needed for org placement UI and
-- the hiring venue picker); HR editors manage them.
ALTER TABLE public.hr_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read hr_locations" ON public.hr_locations;
CREATE POLICY "Staff read hr_locations"
  ON public.hr_locations FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "HR manages hr_locations" ON public.hr_locations;
CREATE POLICY "HR manages hr_locations"
  ON public.hr_locations FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

DROP POLICY IF EXISTS "Staff read business_units" ON public.business_units;
CREATE POLICY "Staff read business_units"
  ON public.business_units FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "HR manages business_units" ON public.business_units;
CREATE POLICY "HR manages business_units"
  ON public.business_units FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_units TO authenticated;
GRANT ALL ON public.hr_locations TO service_role;
GRANT ALL ON public.business_units TO service_role;

-- Seed one office location per campus so the directory/picker is not empty on a
-- fresh install. Wrapped defensively: production already has this table with an
-- unknown row shape, so a seed that does not fit its NOT NULL columns must not
-- fail the whole migration.
DO $$
BEGIN
  INSERT INTO public.hr_locations (name, address, campus_id)
  SELECT c.name, NULLIF(concat_ws(', ', NULLIF(c.address, ''), NULLIF(c.city, '')), ''), c.id
  FROM public.campuses c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.hr_locations hl WHERE lower(hl.name) = lower(c.name)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipped hr_locations seed: %', SQLERRM;
END $$;
