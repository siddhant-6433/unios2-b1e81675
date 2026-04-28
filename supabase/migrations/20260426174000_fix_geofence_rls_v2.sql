-- Fix: use has_role() function like other tables do
DROP POLICY IF EXISTS "read_geofences" ON geofence_locations;
DROP POLICY IF EXISTS "manage_geofences" ON geofence_locations;
DROP POLICY IF EXISTS "update_geofences" ON geofence_locations;
DROP POLICY IF EXISTS "delete_geofences" ON geofence_locations;

-- Read: anyone authenticated
CREATE POLICY "read_geofences"
  ON geofence_locations FOR SELECT TO authenticated
  USING (true);

-- Write: super_admin only (using has_role function like campuses table)
CREATE POLICY "manage_geofences"
  ON geofence_locations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "update_geofences"
  ON geofence_locations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "delete_geofences"
  ON geofence_locations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Also fix employee_attendance RLS to use has_role
DROP POLICY IF EXISTS "Admins can view all attendance" ON employee_attendance;
CREATE POLICY "Admins can view all attendance"
  ON employee_attendance FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'principal')
  );

-- Fix employee_leave_balances
DROP POLICY IF EXISTS "Admins can manage leave balances" ON employee_leave_balances;
CREATE POLICY "Admins can manage leave balances"
  ON employee_leave_balances FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR auth.uid() = user_id);

-- Fix employee_leave_requests
DROP POLICY IF EXISTS "Admins can manage leave requests" ON employee_leave_requests;
CREATE POLICY "Admins can manage leave requests"
  ON employee_leave_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR auth.uid() = user_id);
