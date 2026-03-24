-- ============================================================
-- Person Role Lifecycle
-- lead → applicant → student → alumni
-- ============================================================

-- 1. Add person_role column to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS person_role text NOT NULL DEFAULT 'lead'
    CHECK (person_role IN ('lead', 'applicant', 'student', 'alumni'));

-- 2. Backfill existing leads
-- Anyone with a pre_admission_no or admission_no is already a student
UPDATE leads
SET person_role = 'student'
WHERE (pre_admission_no IS NOT NULL OR admission_no IS NOT NULL)
  AND person_role = 'lead';

-- Anyone whose linked student is inactive/alumni is an alumni
UPDATE leads
SET person_role = 'alumni'
WHERE id IN (
  SELECT lead_id FROM students
  WHERE lead_id IS NOT NULL
    AND status IN ('inactive', 'alumni')
)
AND person_role IN ('lead', 'applicant', 'student');

-- Anyone with an application (and still a lead) is an applicant
UPDATE leads
SET person_role = 'applicant'
WHERE id IN (
  SELECT DISTINCT lead_id FROM applications WHERE lead_id IS NOT NULL
)
AND person_role = 'lead';

-- ============================================================
-- Trigger 1: Application inserted → lead becomes 'applicant'
-- ============================================================
CREATE OR REPLACE FUNCTION fn_application_to_applicant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE leads
    SET person_role = 'applicant'
    WHERE id = NEW.lead_id AND person_role = 'lead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_to_applicant ON applications;
CREATE TRIGGER trg_application_to_applicant
  AFTER INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION fn_application_to_applicant();

-- ============================================================
-- Trigger 2: Lead gets PAN or AN → becomes 'student'
-- Only advances forward (never demotes)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_lead_to_student()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Pre-admission number just assigned
  IF NEW.pre_admission_no IS NOT NULL AND OLD.pre_admission_no IS NULL THEN
    IF NEW.person_role IN ('lead', 'applicant') THEN
      NEW.person_role := 'student';
    END IF;
  END IF;
  -- Admission number just assigned
  IF NEW.admission_no IS NOT NULL AND OLD.admission_no IS NULL THEN
    IF NEW.person_role IN ('lead', 'applicant') THEN
      NEW.person_role := 'student';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_to_student ON leads;
CREATE TRIGGER trg_lead_to_student
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION fn_lead_to_student();

-- ============================================================
-- Trigger 3: Student status → inactive/alumni → lead becomes 'alumni'
-- ============================================================
CREATE OR REPLACE FUNCTION fn_student_to_alumni()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IN ('inactive', 'alumni')
     AND OLD.status NOT IN ('inactive', 'alumni')
     AND NEW.lead_id IS NOT NULL THEN
    UPDATE leads
    SET person_role = 'alumni'
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_to_alumni ON students;
CREATE TRIGGER trg_student_to_alumni
  AFTER UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION fn_student_to_alumni();
