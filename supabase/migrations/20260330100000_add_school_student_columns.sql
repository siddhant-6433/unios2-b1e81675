-- Add school-specific columns to students for Beacon school management
-- Captures parent details, class section, and student type needed for
-- manual entry and bulk import from SchoolKnot / existing records

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS father_name      TEXT,
  ADD COLUMN IF NOT EXISTS father_phone     TEXT,
  ADD COLUMN IF NOT EXISTS mother_name      TEXT,
  ADD COLUMN IF NOT EXISTS mother_phone     TEXT,
  ADD COLUMN IF NOT EXISTS section          TEXT,         -- e.g. 'A', 'B', 'C'
  ADD COLUMN IF NOT EXISTS class_roll_no    TEXT,
  ADD COLUMN IF NOT EXISTS student_type     TEXT DEFAULT 'day_scholar',  -- 'day_scholar' | 'boarder'
  ADD COLUMN IF NOT EXISTS school_admission_no TEXT;      -- admission no from previous system (e.g. SchoolKnot)
