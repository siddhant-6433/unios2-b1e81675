ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_employee_id ON profiles (employee_id) WHERE employee_id IS NOT NULL;
