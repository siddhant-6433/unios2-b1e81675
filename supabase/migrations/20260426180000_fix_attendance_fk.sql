-- Fix: campus_id FK fails when punching from custom geofence locations
-- Make campus_id nullable and add geofence_location_id

ALTER TABLE employee_attendance
  DROP CONSTRAINT IF EXISTS employee_attendance_campus_id_fkey;

ALTER TABLE employee_attendance
  ALTER COLUMN campus_id DROP NOT NULL;

ALTER TABLE employee_attendance
  ADD CONSTRAINT employee_attendance_campus_id_fkey
    FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL;

-- Add optional geofence_location_id for custom locations
ALTER TABLE employee_attendance
  ADD COLUMN IF NOT EXISTS geofence_location_id uuid REFERENCES geofence_locations(id) ON DELETE SET NULL;
