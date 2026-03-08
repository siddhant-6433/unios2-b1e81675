
-- ========== CAMPUS & INSTITUTION HIERARCHY ==========

CREATE TABLE public.campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  address text,
  city text,
  state text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view campuses" ON public.campuses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage campuses" ON public.campuses
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid REFERENCES public.campuses(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('school', 'college')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view institutions" ON public.institutions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage institutions" ON public.institutions
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view departments" ON public.departments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage departments" ON public.departments
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  duration_years int NOT NULL DEFAULT 4,
  type text NOT NULL DEFAULT 'semester' CHECK (type IN ('semester', 'annual', 'quarterly')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view courses" ON public.courses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage courses" ON public.courses
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.admission_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admission_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view sessions" ON public.admission_sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage sessions" ON public.admission_sessions
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES public.admission_sessions(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  section text,
  max_strength int DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view batches" ON public.batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage batches" ON public.batches
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

-- ========== ADMISSION PIPELINE (LEADS) ==========

CREATE TYPE public.lead_stage AS ENUM (
  'new_lead', 'ai_called', 'counsellor_call', 'visit_scheduled',
  'interview', 'offer_sent', 'token_paid', 'pre_admitted', 'admitted', 'rejected'
);

CREATE TYPE public.lead_source AS ENUM (
  'website', 'meta_ads', 'google_ads', 'shiksha', 'walk_in',
  'consultant', 'justdial', 'referral', 'education_fair', 'other'
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  guardian_name text,
  guardian_phone text,
  course_id uuid REFERENCES public.courses(id),
  campus_id uuid REFERENCES public.campuses(id),
  stage lead_stage NOT NULL DEFAULT 'new_lead',
  source lead_source NOT NULL DEFAULT 'website',
  counsellor_id uuid REFERENCES public.profiles(id),
  application_id text UNIQUE,
  pre_admission_no text UNIQUE,
  admission_no text UNIQUE,
  notes text,
  interview_score int,
  interview_result text CHECK (interview_result IN ('pass', 'hold', 'reject')),
  visit_date timestamptz,
  offer_amount numeric(12,2),
  token_amount numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view leads" ON public.leads
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'data_entry')
  );

CREATE POLICY "Staff can insert leads" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'data_entry')
  );

CREATE POLICY "Staff can update leads" ON public.leads
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id),
  type text NOT NULL CHECK (type IN ('note', 'call', 'whatsapp', 'email', 'visit', 'status_change', 'system')),
  description text NOT NULL,
  old_stage lead_stage,
  new_stage lead_stage,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view lead activities" ON public.lead_activities
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

CREATE POLICY "Staff can insert lead activities" ON public.lead_activities
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

-- ========== STUDENTS ==========

CREATE TYPE public.student_status AS ENUM ('pre_admitted', 'active', 'inactive', 'alumni', 'dropped');

CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  lead_id uuid REFERENCES public.leads(id),
  name text NOT NULL,
  phone text,
  email text,
  guardian_name text,
  guardian_phone text,
  dob date,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  address text,
  blood_group text,
  photo_url text,
  pre_admission_no text UNIQUE,
  admission_no text UNIQUE,
  course_id uuid REFERENCES public.courses(id),
  batch_id uuid REFERENCES public.batches(id),
  campus_id uuid REFERENCES public.campuses(id),
  session_id uuid REFERENCES public.admission_sessions(id),
  status student_status NOT NULL DEFAULT 'pre_admitted',
  admission_date date,
  fee_structure_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view students" ON public.students
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'data_entry') OR
    (auth.uid() = user_id)
  );

CREATE POLICY "Admins can manage students" ON public.students
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin')
  );

-- ========== FINANCE ENGINE ==========

CREATE TABLE public.fee_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('tuition', 'hostel', 'transport', 'lab', 'library', 'exam', 'enrollment', 'token', 'late_fee', 'other')),
  is_recurring boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view fee codes" ON public.fee_codes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage fee codes" ON public.fee_codes
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE TABLE public.fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES public.admission_sessions(id) ON DELETE CASCADE NOT NULL,
  version text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id, session_id, version)
);

ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view fee structures" ON public.fee_structures
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage fee structures" ON public.fee_structures
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE TABLE public.fee_structure_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_structure_id uuid REFERENCES public.fee_structures(id) ON DELETE CASCADE NOT NULL,
  fee_code_id uuid REFERENCES public.fee_codes(id) ON DELETE CASCADE NOT NULL,
  term text NOT NULL,
  amount numeric(12,2) NOT NULL,
  due_day int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_structure_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view fee structure items" ON public.fee_structure_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage fee structure items" ON public.fee_structure_items
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE TABLE public.fee_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  fee_code_id uuid REFERENCES public.fee_codes(id) NOT NULL,
  term text NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  concession numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) GENERATED ALWAYS AS (total_amount - concession - paid_amount) STORED,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('paid', 'due', 'overdue')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff can view all ledger" ON public.fee_ledger
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'principal')
  );

CREATE POLICY "Students can view own ledger" ON public.fee_ledger
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = fee_ledger.student_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Finance staff can manage ledger" ON public.fee_ledger
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  fee_ledger_id uuid REFERENCES public.fee_ledger(id),
  amount numeric(12,2) NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('online', 'cash', 'cheque', 'upi', 'bank_transfer')),
  transaction_ref text,
  receipt_no text UNIQUE,
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff can view payments" ON public.payments
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Students can view own payments" ON public.payments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = payments.student_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Finance staff can insert payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

-- ========== CONCESSIONS / SCHOLARSHIPS ==========

CREATE TABLE public.concessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  fee_ledger_id uuid REFERENCES public.fee_ledger(id),
  type text NOT NULL CHECK (type IN ('percentage', 'flat', 'one_time', 'recurring')),
  value numeric(12,2) NOT NULL,
  reason text,
  requested_by uuid REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.concessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff can view concessions" ON public.concessions
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'counsellor')
  );

CREATE POLICY "Counsellors can request concessions" ON public.concessions
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Admins can approve concessions" ON public.concessions
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin')
  );

-- ========== TRIGGERS ==========

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fee_ledger_updated_at
  BEFORE UPDATE ON public.fee_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
