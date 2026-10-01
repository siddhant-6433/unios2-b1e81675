-- HR Asset management (new) + org chart read model.
--
-- Assets are the last "core HR" pillar a Keka-class HRMS expects: a register,
-- assignment to an employee with a return, and a per-employee "my assets" view.
-- The org chart is a thin security-definer read of the reports_to links already
-- on employee_profiles, so the directory can render hierarchy without exposing
-- the whole table.

-- ── Asset register ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag       text NOT NULL UNIQUE,
  name            text NOT NULL,
  category_id     uuid REFERENCES public.asset_categories(id) ON DELETE SET NULL,
  serial_number   text,
  model           text,
  purchase_date   date,
  purchase_cost   numeric(14,2),
  warranty_until  date,
  condition       text,
  status          text NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'assigned', 'maintenance', 'retired', 'lost')),
  location        text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_status_idx ON public.assets (status, name);
CREATE INDEX IF NOT EXISTS assets_category_idx ON public.assets (category_id);

CREATE TABLE IF NOT EXISTS public.asset_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  assigned_at         timestamptz NOT NULL DEFAULT now(),
  assigned_by         uuid REFERENCES auth.users(id),
  returned_at         timestamptz,
  returned_by         uuid REFERENCES auth.users(id),
  condition_on_return text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_assignments_asset_idx ON public.asset_assignments (asset_id, returned_at);
CREATE INDEX IF NOT EXISTS asset_assignments_employee_idx ON public.asset_assignments (employee_profile_id, returned_at);
-- At most one active assignment per asset.
CREATE UNIQUE INDEX IF NOT EXISTS asset_assignments_active_uniq
  ON public.asset_assignments (asset_id) WHERE returned_at IS NULL;

INSERT INTO public.asset_categories (code, name, display_order) VALUES
  ('LAPTOP', 'Laptop', 10),
  ('DESKTOP', 'Desktop', 20),
  ('MOBILE', 'Mobile Phone', 30),
  ('SIM', 'SIM / Data Card', 40),
  ('MONITOR', 'Monitor', 50),
  ('FURNITURE', 'Furniture', 60),
  ('VEHICLE', 'Vehicle', 70),
  ('OTHER', 'Other', 999)
ON CONFLICT (code) DO NOTHING;

-- ── Permission ──────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, action, description)
VALUES ('hr', 'assets_manage', 'Manage the asset register and assignments')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE v_perm uuid; r app_role;
BEGIN
  SELECT id INTO v_perm FROM public.permissions WHERE module = 'hr' AND action = 'assets_manage';
  FOREACH r IN ARRAY ARRAY['super_admin','campus_admin','principal']::app_role[] LOOP
    INSERT INTO public.role_permissions (role, permission_id) VALUES (r, v_perm) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.asset_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read asset categories" ON public.asset_categories;
CREATE POLICY "Staff read asset categories"
  ON public.asset_categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "HR manages asset categories" ON public.asset_categories;
CREATE POLICY "HR manages asset categories"
  ON public.asset_categories FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:assets_manage')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:assets_manage')));

DROP POLICY IF EXISTS "HR reads assets" ON public.assets;
CREATE POLICY "HR reads assets"
  ON public.assets FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:assets_manage'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
  );

DROP POLICY IF EXISTS "Employees read own assets" ON public.assets;
CREATE POLICY "Employees read own assets"
  ON public.assets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.asset_assignments aa
      JOIN public.employee_profiles e ON e.id = aa.employee_profile_id
      WHERE aa.asset_id = assets.id AND e.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "HR manages assets" ON public.assets;
CREATE POLICY "HR manages assets"
  ON public.assets FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:assets_manage')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:assets_manage')));

DROP POLICY IF EXISTS "People read own assignments" ON public.asset_assignments;
CREATE POLICY "People read own assignments"
  ON public.asset_assignments FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:view'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:assets_manage'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = asset_assignments.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR manages assignments" ON public.asset_assignments;
CREATE POLICY "HR manages assignments"
  ON public.asset_assignments FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:assets_manage')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:assets_manage')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_assignments TO authenticated;
GRANT ALL ON public.asset_categories, public.assets, public.asset_assignments TO service_role;

CREATE OR REPLACE FUNCTION public.tg_assets_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_assets_touch ON public.assets;
CREATE TRIGGER trg_assets_touch
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.tg_assets_touch();

-- ── RPCs ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_asset(
  _asset_id uuid, _employee_profile_id uuid, _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_uid uuid; v_name text;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:assets_manage')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Close any current assignment first (reassignment).
  UPDATE public.asset_assignments
     SET returned_at = now(), returned_by = auth.uid(), condition_on_return = 'reassigned'
   WHERE asset_id = _asset_id AND returned_at IS NULL;

  INSERT INTO public.asset_assignments (asset_id, employee_profile_id, assigned_by, notes)
  VALUES (_asset_id, _employee_profile_id, auth.uid(), _notes)
  RETURNING id INTO v_id;

  UPDATE public.assets SET status = 'assigned' WHERE id = _asset_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = _employee_profile_id;
  SELECT name INTO v_name FROM public.assets WHERE id = _asset_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'general', 'Asset assigned', COALESCE(v_name, 'An asset') || ' has been assigned to you.', '/my-hr');
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_asset(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_asset(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.return_asset(
  _assignment_id uuid, _condition text DEFAULT NULL, _notes text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_asset uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:assets_manage')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT asset_id INTO v_asset FROM public.asset_assignments WHERE id = _assignment_id AND returned_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active assignment not found'; END IF;

  UPDATE public.asset_assignments
     SET returned_at = now(), returned_by = auth.uid(),
         condition_on_return = _condition, notes = COALESCE(_notes, notes)
   WHERE id = _assignment_id;

  UPDATE public.assets
     SET status = CASE WHEN _condition IN ('damaged', 'needs_repair') THEN 'maintenance' ELSE 'available' END
   WHERE id = v_asset;

  RETURN 'returned';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.return_asset(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_asset(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hr_asset_summary()
RETURNS TABLE (status text, category text, assets bigint, total_cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_permission(auth.uid(), 'hr:assets_manage')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT a.status, COALESCE(c.name, '—'), count(*)::bigint, COALESCE(sum(a.purchase_cost), 0)
    FROM public.assets a
    LEFT JOIN public.asset_categories c ON c.id = a.category_id
   GROUP BY a.status, c.name
   ORDER BY 1, 2;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_asset_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_asset_summary() TO authenticated, service_role;

-- ── Views ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.asset_assignments_inbox AS
SELECT
  aa.id, aa.asset_id, aa.employee_profile_id, aa.assigned_at, aa.returned_at,
  aa.condition_on_return, aa.notes,
  a.asset_tag, a.name AS asset_name, a.status AS asset_status,
  c.name AS category_name,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  e.employee_number
FROM public.asset_assignments aa
JOIN public.assets a ON a.id = aa.asset_id
LEFT JOIN public.asset_categories c ON c.id = a.category_id
LEFT JOIN public.employee_profiles e ON e.id = aa.employee_profile_id;

ALTER VIEW public.asset_assignments_inbox SET (security_invoker = true);
GRANT SELECT ON public.asset_assignments_inbox TO authenticated, service_role;

-- ── Org chart read model ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_org_chart()
RETURNS TABLE (
  employee_profile_id uuid, display_name text, job_title text, department text,
  campus text, manager_user_id uuid, photo_url text, employment_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))),
    COALESCE(NULLIF(btrim(e.job_title), ''), dg.name),
    d.name,
    c.name,
    e.reports_to,
    e.photo_url,
    COALESCE(e.employment_status, 'Working')
  FROM public.employee_profiles e
  LEFT JOIN public.designations dg ON dg.id = e.designation_id
  LEFT JOIN public.departments d ON d.id = e.department_id
  LEFT JOIN public.campuses c ON c.id = e.campus_id
  WHERE e.date_of_exit IS NULL
    AND e.verification_status = 'verified'
    AND (
      (SELECT public.has_permission(auth.uid(), 'hr:view'))
      OR (SELECT public.has_permission(auth.uid(), 'hr:self'))
    )
  ORDER BY c.name, d.name, 2;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_org_chart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_org_chart() TO authenticated, service_role;
