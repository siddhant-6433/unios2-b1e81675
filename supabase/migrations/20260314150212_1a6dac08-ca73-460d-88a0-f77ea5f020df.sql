
CREATE TABLE public.eligibility_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  min_age integer,
  max_age integer,
  class_12_min_marks numeric,
  graduation_min_marks numeric,
  requires_graduation boolean DEFAULT false,
  entrance_exam_name text,
  entrance_exam_required boolean DEFAULT false,
  subject_prerequisites text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id)
);

ALTER TABLE public.eligibility_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage eligibility rules" ON public.eligibility_rules
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Anyone can view eligibility rules" ON public.eligibility_rules
  FOR SELECT TO anon, authenticated USING (true);

CREATE TRIGGER update_eligibility_rules_updated_at
  BEFORE UPDATE ON public.eligibility_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
