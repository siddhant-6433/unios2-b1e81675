-- Fix RLS policies for geofence_locations
DROP POLICY IF EXISTS "Anyone can view active geofences" ON geofence_locations;
DROP POLICY IF EXISTS "Admins can manage geofences" ON geofence_locations;

-- Read: anyone authenticated
CREATE POLICY "read_geofences"
  ON geofence_locations FOR SELECT
  USING (true);

-- Insert/Update/Delete: super_admin
CREATE POLICY "manage_geofences"
  ON geofence_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "update_geofences"
  ON geofence_locations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "delete_geofences"
  ON geofence_locations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );
