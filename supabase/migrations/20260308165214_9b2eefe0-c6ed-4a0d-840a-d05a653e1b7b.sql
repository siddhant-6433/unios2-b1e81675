
-- Lead Notes
CREATE TABLE public.lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage lead notes" ON public.lead_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role) OR has_role(auth.uid(), 'admission_head'::app_role) OR has_role(auth.uid(), 'counsellor'::app_role));

-- Lead Followups
CREATE TABLE public.lead_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  scheduled_at timestamptz NOT NULL,
  type text NOT NULL DEFAULT 'call',
  status text NOT NULL DEFAULT 'pending',
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage followups" ON public.lead_followups FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role) OR has_role(auth.uid(), 'admission_head'::app_role) OR has_role(auth.uid(), 'counsellor'::app_role));

-- Campus Visits
CREATE TABLE public.campus_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES public.campuses(id),
  scheduled_by uuid REFERENCES auth.users(id),
  visit_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campus_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage visits" ON public.campus_visits FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role) OR has_role(auth.uid(), 'admission_head'::app_role) OR has_role(auth.uid(), 'counsellor'::app_role));

CREATE TRIGGER update_campus_visits_updated_at BEFORE UPDATE ON public.campus_visits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Offer Letters
CREATE TABLE public.offer_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id),
  campus_id uuid REFERENCES public.campuses(id),
  issued_by uuid REFERENCES auth.users(id),
  total_fee numeric NOT NULL,
  scholarship_amount numeric DEFAULT 0,
  net_fee numeric NOT NULL,
  acceptance_deadline date,
  status text NOT NULL DEFAULT 'issued',
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.offer_letters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage offers" ON public.offer_letters FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role) OR has_role(auth.uid(), 'admission_head'::app_role) OR has_role(auth.uid(), 'counsellor'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

-- Lead Allocation Rules
CREATE TABLE public.lead_allocation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  conditions jsonb NOT NULL DEFAULT '{}',
  assignment_type text NOT NULL DEFAULT 'specific',
  assigned_to uuid REFERENCES auth.users(id),
  round_robin_pool uuid[] DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_allocation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage allocation rules" ON public.lead_allocation_rules FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'admission_head'::app_role));
CREATE POLICY "Staff can view allocation rules" ON public.lead_allocation_rules FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'counsellor'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role));

CREATE TRIGGER update_allocation_rules_updated_at BEFORE UPDATE ON public.lead_allocation_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Consultants
CREATE TABLE public.consultants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  organization text,
  city text,
  phone text,
  email text,
  commission_type text DEFAULT 'percentage',
  commission_value numeric DEFAULT 0,
  relationship_manager_id uuid REFERENCES auth.users(id),
  stage text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage consultants" ON public.consultants FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role) OR has_role(auth.uid(), 'admission_head'::app_role));
CREATE POLICY "Counsellors can view consultants" ON public.consultants FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'counsellor'::app_role));

CREATE TRIGGER update_consultants_updated_at BEFORE UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Call Logs (for future telephony)
CREATE TABLE public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  direction text NOT NULL DEFAULT 'outbound',
  duration_seconds integer DEFAULT 0,
  disposition text,
  recording_url text,
  notes text,
  called_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage call logs" ON public.call_logs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'campus_admin'::app_role) OR has_role(auth.uid(), 'admission_head'::app_role) OR has_role(auth.uid(), 'counsellor'::app_role));
