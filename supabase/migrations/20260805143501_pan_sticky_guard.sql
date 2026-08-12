-- PAN stickiness guard: once a Pre-Admission Number (pre_admission_no) is
-- assigned to a row, it can never be nulled. This is the "PAN is always
-- mapped to AN" guarantee — the PAN stays welded to the row for whatever
-- admission_no (AN) it later earns, so a physical ID card printed with a PAN
-- always reconciles to the student's AN.
--
-- A *correction* to a different non-null PAN is still allowed (e.g. fixing a
-- mistyped import). Only NULL-ing a set PAN is blocked. NULL -> value and
-- value -> value both pass; value -> NULL raises.
--
-- Applies to both students and leads (the two tables that carry PAN/AN).
-- Idempotent: CREATE OR REPLACE + drop/recreate triggers.

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
