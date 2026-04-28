-- Allow multiple punch records per day (multiple in/out cycles)
-- Drop the unique constraint on (user_id, date)
ALTER TABLE employee_attendance DROP CONSTRAINT IF EXISTS employee_attendance_user_id_date_key;
