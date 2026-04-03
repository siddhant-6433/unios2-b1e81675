-- Sprint 2 Feature 3: Document Verification Workflow

-- Document checklist per course
CREATE TABLE public.document_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  is_required boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(course_id, document_name)
);

ALTER TABLE public.document_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage document_checklists"
  ON public.document_checklists FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Lead documents (actual uploads + verification status)
CREATE TABLE public.lead_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  checklist_item_id uuid REFERENCES public.document_checklists(id) ON DELETE SET NULL,
  document_name text NOT NULL,
  file_url text,
  file_name text,
  file_size integer,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected')),
  rejection_reason text,
  verified_by uuid REFERENCES public.profiles(id),
  verified_at timestamptz,
  uploaded_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_lead_documents_lead ON public.lead_documents(lead_id);
CREATE INDEX idx_lead_documents_status ON public.lead_documents(status);

ALTER TABLE public.lead_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage lead_documents"
  ON public.lead_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create storage bucket for lead documents (idempotent via INSERT ... ON CONFLICT)
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-documents', 'lead-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload/read
CREATE POLICY "Authenticated users can upload lead documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lead-documents');

CREATE POLICY "Authenticated users can read lead documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lead-documents');

CREATE POLICY "Authenticated users can delete lead documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lead-documents');

-- Seed common document types for all existing courses
-- (Admins can customize later per course)
DO $$
DECLARE v_course record;
BEGIN
  FOR v_course IN SELECT id FROM public.courses LOOP
    INSERT INTO public.document_checklists (course_id, document_name, is_required, sort_order) VALUES
      (v_course.id, '10th Marksheet', true, 1),
      (v_course.id, '12th Marksheet', true, 2),
      (v_course.id, 'Aadhaar Card', true, 3),
      (v_course.id, 'Passport Photo', true, 4),
      (v_course.id, 'Transfer Certificate', false, 5),
      (v_course.id, 'Migration Certificate', false, 6)
    ON CONFLICT (course_id, document_name) DO NOTHING;
  END LOOP;
END $$;
