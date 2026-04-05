-- Approval/Affiliation Bodies table
CREATE TABLE IF NOT EXISTS public.approval_bodies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text UNIQUE,
  short_name text,
  logo_url text,
  description text,
  website_url text,
  body_type text DEFAULT 'regulatory' CHECK (body_type IN ('regulatory', 'university', 'council', 'board')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.approval_bodies ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_bodies TO authenticated;
CREATE POLICY "Authenticated users can manage approval_bodies"
  ON public.approval_bodies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Approval/Affiliation Letters table
CREATE TABLE IF NOT EXISTS public.approval_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text,
  approval_body_id uuid REFERENCES public.approval_bodies(id) ON DELETE SET NULL,
  issue_date date,
  academic_session text,
  institution_name text,
  file_url text,
  file_upload_url text,
  webflow_item_id text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.approval_letters ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_letters TO authenticated;
CREATE POLICY "Authenticated users can manage approval_letters"
  ON public.approval_letters FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Junction table: letters can be tagged to multiple courses
CREATE TABLE IF NOT EXISTS public.approval_letter_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id uuid NOT NULL REFERENCES public.approval_letters(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  UNIQUE(letter_id, course_id)
);

ALTER TABLE public.approval_letter_courses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_letter_courses TO authenticated;
CREATE POLICY "Authenticated users can manage approval_letter_courses"
  ON public.approval_letter_courses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed approval bodies from known data
INSERT INTO public.approval_bodies (name, short_name, slug, body_type, logo_url) VALUES
  ('All India Council for Technical Education', 'AICTE', 'aicte', 'council', '/images/approvals/aicte.png'),
  ('Bar Council of India', 'BCI', 'bci', 'council', '/images/approvals/bci.png'),
  ('Indian Nursing Council', 'INC', 'inc', 'council', '/images/approvals/inc.png'),
  ('Pharmacy Council of India', 'PCI', 'pci', 'council', '/images/approvals/pci.png'),
  ('National Council for Teacher Education', 'NCTE', 'ncte', 'council', '/images/approvals/ncte.png'),
  ('Board of Technical Education, Uttar Pradesh', 'BTE UP', 'bte-up', 'board', '/images/approvals/bteup.png'),
  ('Uttar Pradesh State Medical Faculty', 'UP SMF', 'upsmf', 'board', '/images/approvals/upsmf.png'),
  ('Examination Regulatory Authority Uttar Pradesh', 'ERA UP', 'era-up', 'board', '/images/approvals/bteup.png'),
  ('Central Board of Secondary Education', 'CBSE', 'cbse', 'board', '/images/approvals/cbse.png'),
  ('Council for Indian School Certificate Examinations', 'CISCE', 'cisce', 'board', '/images/approvals/cisce.png'),
  ('Chaudhary Charan Singh University', 'CCSU', 'ccsu', 'university', '/images/approvals/ccsu.png'),
  ('Dr. A.P.J. Abdul Kalam Technical University, Lucknow', 'AKTU', 'aktu', 'university', '/images/approvals/aktu.png'),
  ('Atal Bihari Vajpayee Medical University, Lucknow', 'ABVMU', 'abvmu', 'university', '/images/approvals/abvmu.png'),
  ('University of Rajasthan', 'UoR', 'uor', 'university', '/images/approvals/uor.png'),
  ('Dr. Bhimrao Ambedkar Law University, Jaipur', 'DBALU', 'dbalu', 'university', NULL),
  ('Guru Gobind Singh Indraprastha University', 'GGSIPU', 'ggsipu', 'university', '/images/approvals/ggsipu.png'),
  ('King George Medical University', 'KGMU', 'kgmu', 'university', NULL)
ON CONFLICT (name) DO NOTHING;
