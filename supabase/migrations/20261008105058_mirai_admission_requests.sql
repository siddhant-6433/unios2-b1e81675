-- Parent requests for a Mirai admissions call or campus tour.
CREATE TABLE public.mirai_admission_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('call', 'campus_tour')),
  preferred_time text,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mirai_admission_requests_pending
  ON public.mirai_admission_requests (created_at DESC) WHERE status = 'pending';
CREATE UNIQUE INDEX idx_mirai_admission_request_one_pending_per_type
  ON public.mirai_admission_requests (lead_id, request_type) WHERE status = 'pending';

ALTER TABLE public.mirai_admission_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.mirai_admission_requests TO authenticated;
GRANT ALL ON public.mirai_admission_requests TO service_role;

CREATE POLICY "Mirai admissions staff can manage requests"
  ON public.mirai_admission_requests FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
  );
