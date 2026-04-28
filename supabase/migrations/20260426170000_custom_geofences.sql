-- Custom geofence locations (beyond campuses)
CREATE TABLE IF NOT EXISTS geofence_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  radius_meters integer NOT NULL DEFAULT 500,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE geofence_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active geofences"
  ON geofence_locations FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage geofences"
  ON geofence_locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('super_admin', 'campus_admin', 'principal')
    )
  );
