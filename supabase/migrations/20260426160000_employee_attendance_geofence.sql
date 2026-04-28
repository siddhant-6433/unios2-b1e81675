-- Add geofence columns to campuses
ALTER TABLE campuses
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer DEFAULT 500;

-- Employee attendance (punch in/out)
CREATE TABLE IF NOT EXISTS employee_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  campus_id uuid REFERENCES campuses(id),
  date date NOT NULL DEFAULT CURRENT_DATE,
  punch_in timestamptz,
  punch_out timestamptz,
  selfie_url text,
  location_lat double precision,
  location_lng double precision,
  device_id text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- RLS
ALTER TABLE employee_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own attendance"
  ON employee_attendance FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own attendance"
  ON employee_attendance FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own attendance"
  ON employee_attendance FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins can view all attendance
CREATE POLICY "Admins can view all attendance"
  ON employee_attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('super_admin', 'campus_admin', 'principal', 'admission_head')
    )
  );

-- Employee leave balances
CREATE TABLE IF NOT EXISTS employee_leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  leave_type text NOT NULL CHECK (leave_type IN ('casual', 'sick', 'earned', 'maternity', 'paternity', 'unpaid')),
  total_days integer NOT NULL DEFAULT 0,
  used_days integer NOT NULL DEFAULT 0,
  year integer NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, leave_type, year)
);

ALTER TABLE employee_leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leave balances"
  ON employee_leave_balances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage leave balances"
  ON employee_leave_balances FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('super_admin', 'campus_admin', 'principal')
    )
  );

-- Employee leave requests
CREATE TABLE IF NOT EXISTS employee_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  leave_type text NOT NULL CHECK (leave_type IN ('casual', 'sick', 'earned', 'maternity', 'paternity', 'unpaid')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  days integer NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE employee_leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leave requests"
  ON employee_leave_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own leave requests"
  ON employee_leave_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can cancel own leave requests"
  ON employee_leave_requests FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can manage leave requests"
  ON employee_leave_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('super_admin', 'campus_admin', 'principal')
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_emp_attendance_user_date ON employee_attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_emp_leave_bal_user_year ON employee_leave_balances(user_id, year);
CREATE INDEX IF NOT EXISTS idx_emp_leave_req_user ON employee_leave_requests(user_id, status);
