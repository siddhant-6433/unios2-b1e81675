-- Phase 5: Report Cards

-- 1. Report Card Templates
CREATE TABLE public.ib_report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  programme ib_programme NOT NULL,
  name text NOT NULL,
  academic_year text NOT NULL,
  term text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]',
  header_config jsonb DEFAULT '{}',
  footer_text text,
  is_default boolean DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Generated Report Cards
CREATE TABLE public.ib_report_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.ib_report_templates(id),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.batches(id),
  academic_year text NOT NULL,
  term text NOT NULL,
  report_data jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','teacher_review','coordinator_review','published')),
  homeroom_comment text,
  coordinator_comment text,
  principal_comment text,
  published_at timestamptz,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, student_id, academic_year, term)
);

-- ===== RLS =====
ALTER TABLE public.ib_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_report_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read templates" ON public.ib_report_templates
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Coordinators manage templates" ON public.ib_report_templates
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

CREATE POLICY "Staff manage report_cards" ON public.ib_report_cards
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Students view own published reports" ON public.ib_report_cards
  FOR SELECT TO authenticated USING (
    status = 'published' AND
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );

GRANT ALL ON public.ib_report_templates TO service_role;
GRANT ALL ON public.ib_report_cards TO service_role;
