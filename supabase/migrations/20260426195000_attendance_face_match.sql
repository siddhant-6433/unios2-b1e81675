-- Add face match result to attendance records
ALTER TABLE employee_attendance
  ADD COLUMN IF NOT EXISTS face_match_score integer,
  ADD COLUMN IF NOT EXISTS face_match_result text;
