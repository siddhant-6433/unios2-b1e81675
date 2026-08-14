-- Keep the HR view of where someone works, as text.
--
-- Keka's "Location" and "Department" are not the same concepts as UniOs's `campuses`
-- and `departments`, and forcing them together would corrupt both:
--
--   * `departments` is ACADEMIC — it hangs off an institution and owns courses.
--     Keka's departments are organisational (Finance, Transport, Housekeeping,
--     Human Resource). A driver does not belong to an academic department.
--   * `campuses` drives admissions, fee structures and student filters. Three Keka
--     locations (Mohan Nagar, Preet Vihar Center, Seralis Lab Preet Vihar) are
--     offices with no students, and adding them as campuses would put them in every
--     admissions picker.
--
-- So the source values are preserved verbatim here, losslessly and immediately
-- useful for display and filtering, while campus_id / department_id stay free to be
-- set where the mapping is genuinely real.
ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS work_location     text,
  ADD COLUMN IF NOT EXISTS hr_department     text,
  ADD COLUMN IF NOT EXISTS hr_sub_department text,
  -- The org tree arrives as a manager's NAME, not an id. Resolving it to reports_to
  -- needs every employee imported first, so keep the raw value to resolve later.
  ADD COLUMN IF NOT EXISTS reports_to_name   text;

CREATE INDEX IF NOT EXISTS employee_profiles_work_location_idx
  ON public.employee_profiles (work_location) WHERE work_location IS NOT NULL;

CREATE INDEX IF NOT EXISTS employee_profiles_hr_department_idx
  ON public.employee_profiles (hr_department) WHERE hr_department IS NOT NULL;
