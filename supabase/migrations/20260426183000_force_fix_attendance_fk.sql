-- Force fix: drop ALL foreign key constraints on campus_id and recreate properly
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'employee_attendance'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%campus%'
  ) LOOP
    EXECUTE 'ALTER TABLE employee_attendance DROP CONSTRAINT IF EXISTS ' || r.constraint_name;
  END LOOP;
END $$;

-- Make campus_id nullable (in case it wasn't already)
ALTER TABLE employee_attendance ALTER COLUMN campus_id DROP NOT NULL;

-- Recreate FK with ON DELETE SET NULL
ALTER TABLE employee_attendance
  ADD CONSTRAINT employee_attendance_campus_id_fkey
    FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL
    NOT VALID;

-- Also ensure geofence_location_id exists
ALTER TABLE employee_attendance
  ADD COLUMN IF NOT EXISTS geofence_location_id uuid;

-- Drop and recreate geofence FK too
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'employee_attendance'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%geofence%'
  ) LOOP
    EXECUTE 'ALTER TABLE employee_attendance DROP CONSTRAINT IF EXISTS ' || r.constraint_name;
  END LOOP;
END $$;

ALTER TABLE employee_attendance
  ADD CONSTRAINT employee_attendance_geofence_location_id_fkey
    FOREIGN KEY (geofence_location_id) REFERENCES geofence_locations(id) ON DELETE SET NULL
    NOT VALID;
