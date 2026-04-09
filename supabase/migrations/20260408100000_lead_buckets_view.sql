-- Lead Buckets: unassigned leads split by school vs college
-- Joins leads → courses → departments → institutions to get the type

CREATE OR REPLACE VIEW public.unassigned_leads_bucket AS
SELECT
  l.id,
  l.name,
  l.phone,
  l.email,
  l.stage,
  l.source,
  l.course_id,
  l.campus_id,
  l.created_at,
  l.lead_score,
  l.lead_temperature,
  c.name AS course_name,
  cam.name AS campus_name,
  COALESCE(i.type, 'college') AS bucket  -- 'school' or 'college'
FROM public.leads l
LEFT JOIN public.courses c ON c.id = l.course_id
LEFT JOIN public.departments d ON d.id = c.department_id
LEFT JOIN public.institutions i ON i.id = d.institution_id
LEFT JOIN public.campuses cam ON cam.id = l.campus_id
WHERE l.counsellor_id IS NULL
  AND l.stage NOT IN ('admitted', 'rejected');

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;

-- Lead deletion requests table
CREATE TABLE public.lead_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK (reason IN ('duplicate', 'incorrect', 'spam', 'other')),
  custom_message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view deletion requests"
  ON public.lead_deletion_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create deletion requests"
  ON public.lead_deletion_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = requested_by);

CREATE POLICY "Super admin can update deletion requests"
  ON public.lead_deletion_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
