-- Admission Partner role — table, scope, RPC, policies, grants.
--
-- A narrower cousin of academic_partner (20260619121200). Admission partners
-- source admissions but have NO academic role: they see ONLY the leads they
-- entered, the applications for those leads, and the students those leads
-- convert into. No course/batch assignment scoping, no attendance, no fees
-- teaching, no payouts.
--
-- Scope is a single attribution column (leads.admission_partner_id) funnelled
-- through the one existing seam, can_view_lead(). Everything downstream
-- (lead_activities, applications, students) reuses that seam.
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.

-- ── Partner table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admission_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  organization text,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admission_partners ENABLE ROW LEVEL SECURITY;

-- Attribution column on leads.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS admission_partner_id uuid REFERENCES public.admission_partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_admission_partner_id
  ON public.leads(admission_partner_id) WHERE admission_partner_id IS NOT NULL;

-- ── Scope helper ────────────────────────────────────────────────────────────
-- True when the lead is attributed to an active admission_partners row owned
-- by this user. SECURITY DEFINER so it can read admission_partners regardless
-- of the caller's own RLS.
CREATE OR REPLACE FUNCTION public.can_admission_partner_view_lead(_user_id uuid, _lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.admission_partners ap ON ap.id = l.admission_partner_id
    WHERE l.id = _lead_id
      AND ap.user_id = _user_id
      AND ap.status = 'active'
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_admission_partner_view_lead(uuid, uuid) TO authenticated;

-- ── Extend can_view_lead with the admission-partner branch ──────────────────
-- Body copied verbatim from 20260802081041_accountant_lead_visibility.sql with
-- one OR-branch added at the tail. This is the single seam that gates leads,
-- lead_activities and applications SELECT.
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
      OR has_role(_user_id, 'accountant')
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
  OR public.can_academic_partner_view_mapped_lead(_user_id, _lead_id)
  OR public.can_admission_partner_view_lead(_user_id, _lead_id)
$$;

-- ── Lead insert RPC ─────────────────────────────────────────────────────────
-- Partners create leads through this, never a raw INSERT (avoids the
-- leads insert+RETURNING RLS trap). Forces attribution to the caller's partner
-- row, source='admission_partner', skip_ai_call=true, no counsellor. Dedupes on
-- normalized phone. Mirrors insert_lead (20260827052623).
CREATE OR REPLACE FUNCTION public.admission_partner_insert_lead(
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _guardian_name text DEFAULT NULL,
  _guardian_phone text DEFAULT NULL,
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id uuid;
  v_lead_id uuid;
  v_phone text;
BEGIN
  SELECT id INTO v_partner_id
  FROM public.admission_partners
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Caller is not an active admission partner';
  END IF;

  v_phone := public.normalize_lead_phone(_phone);

  SELECT id INTO v_lead_id
  FROM public.leads
  WHERE public.normalize_lead_phone(phone) = v_phone
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    -- Existing lead: fill blanks, claim attribution only if unattributed.
    UPDATE public.leads SET
      name = COALESCE(NULLIF(_name, ''), name),
      email = COALESCE(NULLIF(_email, ''), email),
      guardian_name = COALESCE(NULLIF(_guardian_name, ''), guardian_name),
      guardian_phone = COALESCE(NULLIF(_guardian_phone, ''), guardian_phone),
      course_id = COALESCE(_course_id, course_id),
      campus_id = COALESCE(_campus_id, campus_id),
      admission_partner_id = COALESCE(admission_partner_id, v_partner_id),
      updated_at = now()
    WHERE id = v_lead_id;
    RETURN v_lead_id;
  END IF;

  INSERT INTO public.leads (
    name, phone, email, guardian_name, guardian_phone,
    source, course_id, campus_id, counsellor_id,
    admission_partner_id, skip_ai_call, stage
  )
  VALUES (
    _name, v_phone, NULLIF(_email, ''),
    NULLIF(_guardian_name, ''), NULLIF(_guardian_phone, ''),
    'admission_partner'::lead_source,
    _course_id, _campus_id, NULL,
    v_partner_id, true,
    'new_lead'::lead_stage
  )
  RETURNING id INTO v_lead_id;

  IF _notes IS NOT NULL AND _notes != '' THEN
    INSERT INTO public.lead_notes (lead_id, content) VALUES (v_lead_id, _notes);
  END IF;

  RETURN v_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admission_partner_insert_lead(text, text, text, text, text, uuid, uuid, text) TO authenticated;

-- ── RLS policies ────────────────────────────────────────────────────────────
-- Partner reads/updates own partner row; admins manage all.
DROP POLICY IF EXISTS "Admission partners read own row" ON public.admission_partners;
CREATE POLICY "Admission partners read own row"
  ON public.admission_partners FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Admins manage admission partners" ON public.admission_partners;
CREATE POLICY "Admins manage admission partners"
  ON public.admission_partners FOR ALL TO authenticated
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

-- Leads: SELECT via can_view_lead; UPDATE own attributed leads (for the
-- convert-to-student stage transition). INSERT is via the RPC only.
DROP POLICY IF EXISTS "Admission partners view own leads" ON public.leads;
CREATE POLICY "Admission partners view own leads"
  ON public.leads FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND public.can_view_lead(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Admission partners update own leads" ON public.leads;
CREATE POLICY "Admission partners update own leads"
  ON public.leads FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND admission_partner_id IN (SELECT id FROM public.admission_partners WHERE user_id = auth.uid() AND status = 'active')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND admission_partner_id IN (SELECT id FROM public.admission_partners WHERE user_id = auth.uid() AND status = 'active')
  );

-- Lead activities: SELECT + INSERT on own leads.
DROP POLICY IF EXISTS "Admission partners view own lead activities" ON public.lead_activities;
CREATE POLICY "Admission partners view own lead activities"
  ON public.lead_activities FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND public.can_view_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Admission partners insert own lead activities" ON public.lead_activities;
CREATE POLICY "Admission partners insert own lead activities"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND public.can_view_lead(auth.uid(), lead_id)
  );

-- Applications: SELECT for own leads (on-behalf fill happens via edge fns).
DROP POLICY IF EXISTS "Admission partners view own applications" ON public.applications;
CREATE POLICY "Admission partners view own applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND lead_id IS NOT NULL
    AND public.can_view_lead(auth.uid(), lead_id)
  );

-- Students: SELECT/INSERT/UPDATE where the source lead is the partner's. This
-- is what lets ConvertToStudentDialog work for the partner.
DROP POLICY IF EXISTS "Admission partners view own students" ON public.students;
CREATE POLICY "Admission partners view own students"
  ON public.students FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND lead_id IS NOT NULL
    AND public.can_view_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Admission partners insert own students" ON public.students;
CREATE POLICY "Admission partners insert own students"
  ON public.students FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND lead_id IS NOT NULL
    AND public.can_view_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Admission partners update own students" ON public.students;
CREATE POLICY "Admission partners update own students"
  ON public.students FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND lead_id IS NOT NULL
    AND public.can_view_lead(auth.uid(), lead_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admission_partner'::app_role)
    AND lead_id IS NOT NULL
    AND public.can_view_lead(auth.uid(), lead_id)
  );

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, action, description) VALUES
  ('admission_partner_portal', 'view', 'View admission partner portal')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'admission_partner'::app_role, id
FROM public.permissions
WHERE (module, action) = ('admission_partner_portal', 'view')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admission_partners TO authenticated;
-- service_role for the apply-link edge functions that read the partner row
-- (the academic-partner service-role-grant bug, 20260730165658, must not repeat).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admission_partners TO service_role;

NOTIFY pgrst, 'reload schema';
