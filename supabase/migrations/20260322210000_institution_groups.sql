-- ── institution_groups: named reporting groups (societies / foundations) ──
CREATE TABLE IF NOT EXISTS public.institution_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.institution_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view institution groups"
  ON public.institution_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage institution groups"
  ON public.institution_groups FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.institution_groups TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.institution_groups TO authenticated;

-- ── institution_group_members: many-to-many ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.institution_group_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES public.institution_groups(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, institution_id)
);

ALTER TABLE public.institution_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view group members"
  ON public.institution_group_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage group members"
  ON public.institution_group_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.institution_group_members TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.institution_group_members TO authenticated;

-- ── Seed the 3 initial groups ─────────────────────────────────────────────
INSERT INTO public.institution_groups (id, name, code, description) VALUES
  ('aa000001-0000-0000-0000-000000000001',
   'Campus Education Development Society', 'CEDS',
   'Ghaziabad school institutions: Beacon Arthala, Campus School Education, Mirai Experiential'),
  ('aa000001-0000-0000-0000-000000000002',
   'United Educational Society', 'UES',
   'Kotputli institutions: Law, Management, B.Ed'),
  ('aa000001-0000-0000-0000-000000000003',
   'NIMT B Schools Foundation', 'NBF',
   'All institutions under Greater Noida Campus')
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description;

-- ── Seed group members ────────────────────────────────────────────────────
DO $$
DECLARE
  v_ceds uuid := 'aa000001-0000-0000-0000-000000000001';
  v_ues  uuid := 'aa000001-0000-0000-0000-000000000002';
  v_nbf  uuid := 'aa000001-0000-0000-0000-000000000003';
  v_id   uuid;
BEGIN
  -- CEDS: GZ1-BSA, GZ1-CEDS, GZ1-MES
  FOR v_id IN SELECT id FROM public.institutions WHERE code IN ('GZ1-BSA','GZ1-CEDS','GZ1-MES') LOOP
    INSERT INTO public.institution_group_members (group_id, institution_id)
    VALUES (v_ceds, v_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- UES: KT-LAW, KT-MGMT, KT-BED
  FOR v_id IN SELECT id FROM public.institutions WHERE code IN ('KT-LAW','KT-MGMT','KT-BED') LOOP
    INSERT INTO public.institution_group_members (group_id, institution_id)
    VALUES (v_ues, v_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- NBF: all institutions under GN campus
  FOR v_id IN
    SELECT i.id FROM public.institutions i
    JOIN public.campuses c ON c.id = i.campus_id
    WHERE c.code = 'GN'
  LOOP
    INSERT INTO public.institution_group_members (group_id, institution_id)
    VALUES (v_nbf, v_id) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
