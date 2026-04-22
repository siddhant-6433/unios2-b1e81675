-- =====================================================
-- Publisher Portal
-- Publishers (Collegedunia, Collegehai, etc.) can log in
-- and see only the leads they supplied, with current stage
-- and timeline. Read-only; no internal data exposed.
-- =====================================================

-- 1. Add publisher role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'publisher';

-- 2. Publishers table (one record per source partner)
CREATE TABLE IF NOT EXISTS public.publishers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name  text NOT NULL,
  source        text NOT NULL,          -- matches leads.source enum value
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publishers_user ON public.publishers(user_id);
CREATE INDEX IF NOT EXISTS idx_publishers_source ON public.publishers(source);

ALTER TABLE public.publishers ENABLE ROW LEVEL SECURITY;

-- Publishers can read their own record; admins manage all
CREATE POLICY "Publisher can view own record"
  ON public.publishers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'campus_admin'));

CREATE POLICY "Admins manage publishers"
  ON public.publishers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'campus_admin'));

GRANT SELECT ON public.publishers TO authenticated;
GRANT ALL ON public.publishers TO service_role;

-- 3. Update can_view_lead to include publisher access (source match)
CREATE OR REPLACE FUNCTION public.can_view_lead(_user_id uuid, _lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Staff roles: unrestricted
  SELECT EXISTS (
    SELECT 1 WHERE has_role(_user_id, 'super_admin')
      OR has_role(_user_id, 'campus_admin')
      OR has_role(_user_id, 'admission_head')
      OR has_role(_user_id, 'principal')
      OR has_role(_user_id, 'data_entry')
  )
  -- Primary counsellor
  OR EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE l.id = _lead_id AND p.user_id = _user_id
  )
  -- Secondary counsellor
  OR EXISTS (
    SELECT 1 FROM public.lead_counsellors lc
    JOIN public.profiles p ON p.id = lc.counsellor_id
    WHERE lc.lead_id = _lead_id AND p.user_id = _user_id
  )
  -- Team leader
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
  -- Publisher: can view leads whose source matches their registered source
  OR EXISTS (
    SELECT 1 FROM public.publishers pb
    JOIN public.leads l ON l.source::text = pb.source
    WHERE pb.user_id = _user_id AND pb.is_active = true AND l.id = _lead_id
  )
$$;

-- 4. Allow publishers to read lead_activities for their leads (stage changes only —
--    'note' and 'ai_call' type activities excluded in the API layer, but SELECT is granted here)
DROP POLICY IF EXISTS "Staff can view lead activities" ON public.lead_activities;
CREATE POLICY "Staff can view lead activities" ON public.lead_activities
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    -- Publishers: only public activity types for their own leads
    (
      public.has_role(auth.uid(), 'publisher') AND
      type IN ('stage_change', 'application_submitted', 'application_started', 'payment') AND
      EXISTS (
        SELECT 1 FROM public.publishers pb
        JOIN public.leads l ON l.source::text = pb.source
        WHERE pb.user_id = auth.uid() AND pb.is_active = true AND l.id = lead_id
      )
    )
  );

-- 5. Register publisher_portal:view permission and assign to publisher role
INSERT INTO public.permissions (module, action, description)
VALUES ('publisher_portal', 'view', 'Access the publisher leads portal')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'publisher', id FROM public.permissions WHERE module = 'publisher_portal' AND action = 'view'
ON CONFLICT (role, permission_id) DO NOTHING;
