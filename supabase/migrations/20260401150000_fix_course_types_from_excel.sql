-- Sync course types to match updated.xlsx Eligibility sheet.
--
-- Changes:
--  1. BPT-GN: semester → annual  (Excel EXAM MODE = ANNUAL)
--  2. PGDM-GN/GZ/KT: quarterly → trimester  (Excel EXAM MODE = TRIMESTER)
--     Requires adding 'trimester' to the courses.type CHECK constraint first.

-- 1. Widen the CHECK constraint to include 'trimester'
ALTER TABLE public.courses
  DROP CONSTRAINT IF EXISTS courses_type_check;

ALTER TABLE public.courses
  ADD CONSTRAINT courses_type_check
    CHECK (type IN ('semester', 'annual', 'quarterly', 'trimester'));

-- 2. Fix BPT (was wrongly set to semester in migration 20260401130000)
UPDATE public.courses SET type = 'annual'    WHERE code = 'BPT-GN';

-- 3. Fix PGDM campuses (quarterly → trimester)
UPDATE public.courses SET type = 'trimester' WHERE code IN ('PGDM-GN', 'PGDM-GZ', 'PGDM-KT');
