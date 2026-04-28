-- Grant table-level permissions (RLS handles row-level)
GRANT SELECT, INSERT, UPDATE, DELETE ON geofence_locations TO authenticated;
GRANT SELECT ON geofence_locations TO anon;

-- Also grant for employee tables created earlier
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_leave_balances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_leave_requests TO authenticated;
