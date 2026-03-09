
-- Teams table
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  leader_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Team members table
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- Lead counsellors junction table
CREATE TABLE public.lead_counsellors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'secondary',
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, counsellor_id)
);
ALTER TABLE public.lead_counsellors ENABLE ROW LEVEL SECURITY;

-- Teams RLS
CREATE POLICY "Super admins can manage teams" ON public.teams FOR ALL USING (has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admission heads can manage teams" ON public.teams FOR ALL USING (has_role(auth.uid(), 'admission_head'));
CREATE POLICY "Team leaders can view own team" ON public.teams FOR SELECT USING (leader_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "Counsellors can view their team" ON public.teams FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = teams.id AND tm.user_id = auth.uid())
);

-- Team members RLS
CREATE POLICY "Super admins can manage team members" ON public.team_members FOR ALL USING (has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admission heads can manage team members" ON public.team_members FOR ALL USING (has_role(auth.uid(), 'admission_head'));
CREATE POLICY "Team leaders can manage own team members" ON public.team_members FOR ALL USING (
  EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND t.leader_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1))
);
CREATE POLICY "Members can view own team" ON public.team_members FOR SELECT USING (user_id = auth.uid());

-- Lead counsellors RLS
CREATE POLICY "Staff can manage lead counsellors" ON public.lead_counsellors FOR ALL USING (
  has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'admission_head') OR has_role(auth.uid(), 'campus_admin')
);
CREATE POLICY "Primary counsellor can add secondary" ON public.lead_counsellors FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_counsellors.lead_id AND l.counsellor_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1))
);
CREATE POLICY "Counsellors can view their lead assignments" ON public.lead_counsellors FOR SELECT USING (
  counsellor_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1)
  OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_counsellors.lead_id AND l.counsellor_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1))
);

-- Security definer function to check lead visibility
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
$$;

-- Replace the old leads SELECT policy
DROP POLICY IF EXISTS "Staff can view leads" ON public.leads;
CREATE POLICY "Staff can view leads" ON public.leads FOR SELECT TO authenticated
USING (public.can_view_lead(auth.uid(), id));
