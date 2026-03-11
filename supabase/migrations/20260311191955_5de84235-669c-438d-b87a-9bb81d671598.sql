
-- Applications table
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text UNIQUE NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.admission_sessions(id),
  status text NOT NULL DEFAULT 'draft',
  course_selections jsonb NOT NULL DEFAULT '[]'::jsonb,
  full_name text NOT NULL DEFAULT '',
  gender text,
  dob date,
  nationality text DEFAULT 'Indian',
  category text,
  aadhaar text,
  phone text NOT NULL DEFAULT '',
  email text,
  whatsapp_verified boolean DEFAULT false,
  address jsonb DEFAULT '{}'::jsonb,
  father jsonb DEFAULT '{}'::jsonb,
  mother jsonb DEFAULT '{}'::jsonb,
  guardian jsonb DEFAULT '{}'::jsonb,
  apaar_id text,
  pen_number text,
  academic_details jsonb DEFAULT '{}'::jsonb,
  result_status jsonb DEFAULT '{}'::jsonb,
  extracurricular jsonb DEFAULT '{}'::jsonb,
  school_details jsonb DEFAULT '{}'::jsonb,
  completed_sections jsonb DEFAULT '{"personal": false, "parents": false, "academic": false, "documents": false, "payment": false}'::jsonb,
  fee_amount numeric DEFAULT 0,
  payment_status text DEFAULT 'pending',
  payment_ref text,
  flags text[] DEFAULT '{}',
  institution_id uuid,
  program_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert applications" ON public.applications FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can view applications" ON public.applications FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can update applications" ON public.applications FOR UPDATE TO anon, authenticated USING (true);

CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('application-documents', 'application-documents', false);
CREATE POLICY "Anyone can upload application docs" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'application-documents');
CREATE POLICY "Anyone can view application docs" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'application-documents');
