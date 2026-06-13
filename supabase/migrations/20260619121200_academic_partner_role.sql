-- Academic Partner role, scoped access, dashboards, and payouts.

CREATE TABLE IF NOT EXISTS public.academic_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  organization text,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  default_payout_percentage numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_payout_percentage >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academic_partner_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.academic_partners(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.batches(id) ON DELETE CASCADE,
  payout_percentage numeric(5,2) CHECK (payout_percentage >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(partner_id, course_id, batch_id)
);

CREATE TABLE IF NOT EXISTS public.academic_partner_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.academic_partners(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  lead_payment_id uuid REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  course_id uuid REFERENCES public.courses(id),
  batch_id uuid REFERENCES public.batches(id),
  payout_percentage numeric(5,2) NOT NULL DEFAULT 0,
  fee_paid numeric(12,2) NOT NULL DEFAULT 0,
  payout_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
  approved_by uuid REFERENCES public.profiles(id),
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS academic_partner_id uuid REFERENCES public.academic_partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_academic_partners_user ON public.academic_partners(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_academic_partner_assignments_partner ON public.academic_partner_assignments(partner_id);
CREATE INDEX IF NOT EXISTS idx_academic_partner_assignments_scope ON public.academic_partner_assignments(course_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_academic_partner_payouts_partner ON public.academic_partner_payouts(partner_id);
CREATE INDEX IF NOT EXISTS idx_leads_academic_partner ON public.leads(academic_partner_id);

ALTER TABLE public.academic_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_partner_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_partner_payouts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_academic_partner_scope(_user_id uuid, _course_id uuid, _batch_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.academic_partners ap
    JOIN public.academic_partner_assignments apa ON apa.partner_id = ap.id
    WHERE ap.user_id = _user_id
      AND ap.status = 'active'
      AND apa.is_active = true
      AND apa.course_id = _course_id
      AND (
        apa.batch_id IS NULL
        OR _batch_id IS NULL
        OR apa.batch_id = _batch_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_lead(_user_id uuid, _lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 WHERE has_role(_user_id, 'super_admin')
      OR has_role(_user_id, 'campus_admin')
      OR has_role(_user_id, 'admission_head')
      OR has_role(_user_id, 'principal')
      OR has_role(_user_id, 'data_entry')
  )
  OR EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE l.id = _lead_id AND p.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.lead_counsellors lc
    JOIN public.profiles p ON p.id = lc.counsellor_id
    WHERE lc.lead_id = _lead_id AND p.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.profiles leader_p ON leader_p.id = t.leader_id AND leader_p.user_id = _user_id
    JOIN public.team_members tm ON tm.team_id = t.id
    WHERE EXISTS (
      SELECT 1 FROM public.leads l
      JOIN public.profiles mp ON mp.user_id = tm.user_id AND mp.id = l.counsellor_id
      WHERE l.id = _lead_id
    )
    OR EXISTS (
      SELECT 1 FROM public.lead_counsellors lc
      JOIN public.profiles mp ON mp.user_id = tm.user_id AND mp.id = lc.counsellor_id
      WHERE lc.lead_id = _lead_id
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.publishers pb
    JOIN public.leads l ON l.source::text = pb.source
    WHERE pb.user_id = _user_id AND pb.is_active = true AND l.id = _lead_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.academic_partners ap ON ap.id = l.academic_partner_id
    WHERE l.id = _lead_id
      AND ap.user_id = _user_id
      AND ap.status = 'active'
  )
  OR EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id = _lead_id
      AND l.course_id IS NOT NULL
      AND public.is_academic_partner_scope(_user_id, l.course_id, NULL)
  )
$$;

DROP VIEW IF EXISTS public.academic_partner_dashboard;
CREATE VIEW public.academic_partner_dashboard AS
SELECT
  ap.id AS partner_id,
  ap.user_id,
  ap.name AS partner_name,
  ap.organization,
  ap.phone,
  ap.email,
  ap.status,
  ap.default_payout_percentage,
  (SELECT COUNT(DISTINCT apa.course_id)
     FROM public.academic_partner_assignments apa
    WHERE apa.partner_id = ap.id AND apa.is_active = true) AS assigned_courses,
  (SELECT COUNT(DISTINCT apa.batch_id)
     FROM public.academic_partner_assignments apa
    WHERE apa.partner_id = ap.id AND apa.batch_id IS NOT NULL AND apa.is_active = true) AS assigned_batches,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id) AS total_leads,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id AND l.stage = 'admitted') AS conversions,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id AND l.stage NOT IN ('rejected', 'admitted')) AS pipeline,
  (SELECT COUNT(DISTINCT s.id)
     FROM public.students s
    WHERE EXISTS (
      SELECT 1 FROM public.academic_partner_assignments apa
      WHERE apa.partner_id = ap.id
        AND apa.is_active = true
        AND apa.course_id = s.course_id
        AND (apa.batch_id IS NULL OR apa.batch_id = s.batch_id)
    )) AS total_candidates,
  COALESCE((SELECT SUM(fl.paid_amount)
     FROM public.fee_ledger fl
     JOIN public.students s ON s.id = fl.student_id
    WHERE EXISTS (
      SELECT 1 FROM public.academic_partner_assignments apa
      WHERE apa.partner_id = ap.id
        AND apa.is_active = true
        AND apa.course_id = s.course_id
        AND (apa.batch_id IS NULL OR apa.batch_id = s.batch_id)
    )), 0)::numeric(12,2) AS total_fee_collected,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status IN ('pending', 'approved', 'paid')), 0)::numeric(12,2) AS total_payout,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status IN ('pending', 'approved')), 0)::numeric(12,2) AS pending_payout,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status = 'paid'), 0)::numeric(12,2) AS paid_payout
FROM public.academic_partners ap;

DROP VIEW IF EXISTS public.academic_partner_assignment_summary;
CREATE VIEW public.academic_partner_assignment_summary AS
SELECT
  apa.id,
  apa.partner_id,
  apa.course_id,
  c.name AS course_name,
  apa.batch_id,
  b.name AS batch_name,
  apa.payout_percentage,
  COALESCE(apa.payout_percentage, ap.default_payout_percentage) AS effective_payout_percentage,
  apa.is_active,
  COUNT(DISTINCT s.id) AS candidates,
  COALESCE(SUM(fl.paid_amount), 0)::numeric(12,2) AS fee_collected
FROM public.academic_partner_assignments apa
JOIN public.academic_partners ap ON ap.id = apa.partner_id
JOIN public.courses c ON c.id = apa.course_id
LEFT JOIN public.batches b ON b.id = apa.batch_id
LEFT JOIN public.students s ON s.course_id = apa.course_id AND (apa.batch_id IS NULL OR s.batch_id = apa.batch_id)
LEFT JOIN public.fee_ledger fl ON fl.student_id = s.id
GROUP BY apa.id, apa.partner_id, apa.course_id, c.name, apa.batch_id, b.name, apa.payout_percentage, ap.default_payout_percentage, apa.is_active;

DROP POLICY IF EXISTS "Admins manage academic partners" ON public.academic_partners;
CREATE POLICY "Admins manage academic partners"
  ON public.academic_partners FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Academic partners read own profile" ON public.academic_partners;
CREATE POLICY "Academic partners read own profile"
  ON public.academic_partners FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage academic partner assignments" ON public.academic_partner_assignments;
CREATE POLICY "Admins manage academic partner assignments"
  ON public.academic_partner_assignments FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Academic partners read own assignments" ON public.academic_partner_assignments;
CREATE POLICY "Academic partners read own assignments"
  ON public.academic_partner_assignments FOR SELECT TO authenticated
  USING (partner_id IN (SELECT id FROM public.academic_partners WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage academic partner payouts" ON public.academic_partner_payouts;
CREATE POLICY "Admins manage academic partner payouts"
  ON public.academic_partner_payouts FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Academic partners read own payouts" ON public.academic_partner_payouts;
CREATE POLICY "Academic partners read own payouts"
  ON public.academic_partner_payouts FOR SELECT TO authenticated
  USING (partner_id IN (SELECT id FROM public.academic_partners WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Academic partners view own leads" ON public.leads;
CREATE POLICY "Academic partners view own leads"
  ON public.leads FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_view_lead(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Academic partners insert scoped leads" ON public.leads;
CREATE POLICY "Academic partners insert scoped leads"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND academic_partner_id IN (SELECT id FROM public.academic_partners WHERE user_id = auth.uid() AND status = 'active')
    AND source = 'academic_partner'::lead_source
    AND course_id IS NOT NULL
    AND public.is_academic_partner_scope(auth.uid(), course_id, NULL)
  );

DROP POLICY IF EXISTS "Academic partners update own admission leads" ON public.leads;
CREATE POLICY "Academic partners update own admission leads"
  ON public.leads FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND academic_partner_id IN (SELECT id FROM public.academic_partners WHERE user_id = auth.uid() AND status = 'active')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND academic_partner_id IN (SELECT id FROM public.academic_partners WHERE user_id = auth.uid() AND status = 'active')
  );

DROP POLICY IF EXISTS "Academic partners view own lead activities" ON public.lead_activities;
CREATE POLICY "Academic partners view own lead activities"
  ON public.lead_activities FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_view_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Academic partners insert own lead activities" ON public.lead_activities;
CREATE POLICY "Academic partners insert own lead activities"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_view_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned students" ON public.students;
CREATE POLICY "Academic partners view assigned students"
  ON public.students FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND course_id IS NOT NULL
    AND public.is_academic_partner_scope(auth.uid(), course_id, batch_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned attendance" ON public.daily_attendance;
CREATE POLICY "Academic partners view assigned attendance"
  ON public.daily_attendance FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = daily_attendance.student_id
        AND s.course_id IS NOT NULL
        AND public.is_academic_partner_scope(auth.uid(), s.course_id, COALESCE(daily_attendance.batch_id, s.batch_id))
    )
  );

DROP POLICY IF EXISTS "Academic partners view assigned fee ledger" ON public.fee_ledger;
CREATE POLICY "Academic partners view assigned fee ledger"
  ON public.fee_ledger FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = fee_ledger.student_id
        AND s.course_id IS NOT NULL
        AND public.is_academic_partner_scope(auth.uid(), s.course_id, s.batch_id)
    )
  );

DROP POLICY IF EXISTS "Academic partners view assigned payments" ON public.payments;
CREATE POLICY "Academic partners view assigned payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = payments.student_id
        AND s.course_id IS NOT NULL
        AND public.is_academic_partner_scope(auth.uid(), s.course_id, s.batch_id)
    )
  );

DROP POLICY IF EXISTS "Academic partners view assigned ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Academic partners view assigned ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND EXISTS (
      SELECT 1
      FROM public.fee_ledger fl
      JOIN public.students s ON s.id = fl.student_id
      WHERE fl.id = fee_ledger_payments.fee_ledger_id
        AND s.course_id IS NOT NULL
        AND public.is_academic_partner_scope(auth.uid(), s.course_id, s.batch_id)
    )
  );

DROP POLICY IF EXISTS "Academic partners view assigned applications" ON public.applications;
CREATE POLICY "Academic partners view assigned applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND lead_id IS NOT NULL
    AND public.can_view_lead(auth.uid(), lead_id)
  );

INSERT INTO public.permissions (module, action, description) VALUES
  ('academic_partners', 'view', 'View academic partners and partner dashboards'),
  ('academic_partners', 'create', 'Create academic partners'),
  ('academic_partners', 'edit', 'Edit academic partners and assignments'),
  ('academic_partner_portal', 'view', 'View academic partner portal')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'academic_partner'::app_role, id
FROM public.permissions
WHERE (module, action) IN (
  ('academic_partner_portal', 'view'),
  ('dashboard', 'view'),
  ('students', 'view'),
  ('attendance', 'view'),
  ('finance', 'view'),
  ('leads', 'view'),
  ('leads', 'create'),
  ('courses_fees', 'view')
)
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT role_name::app_role, p.id
FROM (VALUES ('campus_admin'), ('principal'), ('admission_head')) AS r(role_name)
CROSS JOIN public.permissions p
WHERE p.module = 'academic_partners' AND p.action IN ('view', 'create', 'edit')
ON CONFLICT (role, permission_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_partners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_partner_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_partner_payouts TO authenticated;
GRANT SELECT ON public.academic_partner_dashboard TO authenticated;
GRANT SELECT ON public.academic_partner_assignment_summary TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_academic_partner_scope(uuid, uuid, uuid) TO authenticated;
