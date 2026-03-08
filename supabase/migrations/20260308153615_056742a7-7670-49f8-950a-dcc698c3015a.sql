
-- Employee profiles table (Keka HR-style)
CREATE TABLE public.employee_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Primary Details
  employee_number text,
  first_name text,
  middle_name text,
  last_name text,
  display_name text,
  gender text,
  date_of_birth date,
  marital_status text,
  blood_group text,
  nationality text DEFAULT 'India',
  physically_handicapped boolean DEFAULT false,
  photo_url text,
  
  -- Contact Details
  work_email text,
  personal_email text,
  mobile_number text,
  work_number text,
  residence_number text,
  
  -- Address
  current_address jsonb DEFAULT '{}',
  permanent_address jsonb DEFAULT '{}',
  
  -- Job Details
  date_of_joining date,
  job_title text,
  job_title_secondary text,
  department_id uuid REFERENCES public.departments(id),
  campus_id uuid REFERENCES public.campuses(id),
  institution_id uuid REFERENCES public.institutions(id),
  worker_type text DEFAULT 'Permanent',
  time_type text DEFAULT 'Full Time',
  notice_period_days integer DEFAULT 90,
  reports_to uuid REFERENCES auth.users(id),
  dotted_line_manager uuid REFERENCES auth.users(id),
  employment_status text DEFAULT 'Working',
  
  -- Identity Information
  pan_number text,
  aadhaar_number text,
  
  -- Education (stored as JSONB array)
  education jsonb DEFAULT '[]',
  
  -- Experience (stored as JSONB array)
  experience jsonb DEFAULT '[]',
  
  -- Professional Summary
  professional_summary text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage employee profiles"
  ON public.employee_profiles FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role));

CREATE POLICY "Users can view own employee profile"
  ON public.employee_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own employee profile"
  ON public.employee_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "HR staff can view all employee profiles"
  ON public.employee_profiles FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'principal'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_employee_profiles_updated_at
  BEFORE UPDATE ON public.employee_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
