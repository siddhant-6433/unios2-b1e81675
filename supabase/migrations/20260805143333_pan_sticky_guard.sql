-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260805143333 name=pan_sticky_guard applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.guard_pan_not_nulled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.pre_admission_no IS NOT NULL AND NEW.pre_admission_no IS NULL THEN
    RAISE EXCEPTION
      'pre_admission_no (PAN %) cannot be removed from % once assigned',
      OLD.pre_admission_no, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_pan_not_nulled ON public.students;
CREATE TRIGGER trg_guard_pan_not_nulled
  BEFORE UPDATE OF pre_admission_no ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.guard_pan_not_nulled();

DROP TRIGGER IF EXISTS trg_guard_pan_not_nulled ON public.leads;
CREATE TRIGGER trg_guard_pan_not_nulled
  BEFORE UPDATE OF pre_admission_no ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.guard_pan_not_nulled();
