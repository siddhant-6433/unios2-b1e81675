-- Library staff assignment and branch-scoped operations.

CREATE TABLE IF NOT EXISTS public.library_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.library_branches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignment_role text NOT NULL DEFAULT 'librarian'
    CHECK (assignment_role IN ('manager', 'librarian', 'assistant', 'auditor')),
  can_catalog boolean NOT NULL DEFAULT true,
  can_circulate boolean NOT NULL DEFAULT true,
  can_inventory boolean NOT NULL DEFAULT true,
  can_digitize boolean NOT NULL DEFAULT true,
  can_manage_settings boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_library_staff_assignments_user_active
  ON public.library_staff_assignments(user_id, active);
CREATE INDEX IF NOT EXISTS idx_library_staff_assignments_branch_active
  ON public.library_staff_assignments(branch_id, active);

DROP TRIGGER IF EXISTS trg_library_staff_assignments_updated_at ON public.library_staff_assignments;
CREATE TRIGGER trg_library_staff_assignments_updated_at
  BEFORE UPDATE ON public.library_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.library_user_can_create_branch(_user_id uuid, _campus_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(_user_id, 'campus_admin'::public.app_role)
        OR public.has_role(_user_id, 'principal'::public.app_role)
      )
      AND public.user_can_access_assigned_campus(_user_id, _campus_id)
    )
$$;

CREATE OR REPLACE FUNCTION public.library_user_can_access_branch(
  _user_id uuid,
  _branch_id uuid,
  _action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.library_branches b
      WHERE b.id = _branch_id
        AND (
          (
            (
              public.has_role(_user_id, 'campus_admin'::public.app_role)
              OR public.has_role(_user_id, 'principal'::public.app_role)
            )
            AND public.user_can_access_assigned_campus(_user_id, b.campus_id)
            AND _action IN ('view', 'manage_settings', 'export')
          )
          OR EXISTS (
            SELECT 1
            FROM public.library_staff_assignments a
            WHERE a.branch_id = b.id
              AND a.user_id = _user_id
              AND a.active
              AND (
                a.assignment_role = 'manager'
                OR _action = 'view'
                OR (_action = 'catalog' AND a.can_catalog)
                OR (_action = 'circulate' AND a.can_circulate)
                OR (_action = 'inventory' AND a.can_inventory)
                OR (_action = 'digitize' AND a.can_digitize)
                OR (_action = 'manage_settings' AND a.can_manage_settings)
                OR (_action = 'export' AND (a.can_manage_settings OR a.can_inventory OR a.can_circulate))
              )
          )
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.library_user_has_any_assignment(
  _user_id uuid,
  _action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin'::public.app_role)
    OR public.has_role(_user_id, 'campus_admin'::public.app_role)
    OR public.has_role(_user_id, 'principal'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.library_staff_assignments a
      WHERE a.user_id = _user_id
        AND a.active
        AND (
          a.assignment_role = 'manager'
          OR _action = 'view'
          OR (_action = 'catalog' AND a.can_catalog)
          OR (_action = 'circulate' AND a.can_circulate)
          OR (_action = 'inventory' AND a.can_inventory)
          OR (_action = 'digitize' AND a.can_digitize)
          OR (_action = 'manage_settings' AND a.can_manage_settings)
          OR (_action = 'export' AND (a.can_manage_settings OR a.can_inventory OR a.can_circulate))
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_library()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
$$;

CREATE OR REPLACE FUNCTION public.can_operate_library()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.library_user_has_any_assignment(auth.uid(), 'catalog')
    OR public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'inventory')
    OR public.library_user_has_any_assignment(auth.uid(), 'digitize')
$$;

ALTER TABLE public.library_staff_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Library staff assignments are visible by scope" ON public.library_staff_assignments;
CREATE POLICY "Library staff assignments are visible by scope" ON public.library_staff_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings')
  );

DROP POLICY IF EXISTS "Library managers assign staff" ON public.library_staff_assignments;
CREATE POLICY "Library managers assign staff" ON public.library_staff_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings')
  );

DROP POLICY IF EXISTS "Library managers update staff assignments" ON public.library_staff_assignments;
CREATE POLICY "Library managers update staff assignments" ON public.library_staff_assignments
  FOR UPDATE TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'))
  WITH CHECK (public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'));

DROP POLICY IF EXISTS "Library managers remove staff assignments" ON public.library_staff_assignments;
CREATE POLICY "Library managers remove staff assignments" ON public.library_staff_assignments
  FOR DELETE TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'));

DROP POLICY IF EXISTS "Library managers maintain branches" ON public.library_branches;
CREATE POLICY "Library managers maintain branches" ON public.library_branches
  FOR ALL TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), id, 'manage_settings'))
  WITH CHECK (public.library_user_can_create_branch(auth.uid(), campus_id));

DROP POLICY IF EXISTS "Library staff catalog books" ON public.library_books;
CREATE POLICY "Library staff catalog books" ON public.library_books
  FOR ALL TO authenticated
  USING (public.library_user_has_any_assignment(auth.uid(), 'catalog'))
  WITH CHECK (public.library_user_has_any_assignment(auth.uid(), 'catalog'));

DROP POLICY IF EXISTS "Library staff manage items" ON public.library_items;
DROP POLICY IF EXISTS "Library staff catalog items" ON public.library_items;
CREATE POLICY "Library staff catalog items" ON public.library_items
  FOR INSERT TO authenticated
  WITH CHECK (public.library_user_can_access_branch(auth.uid(), branch_id, 'catalog'));

DROP POLICY IF EXISTS "Library staff update items" ON public.library_items;
CREATE POLICY "Library staff update items" ON public.library_items
  FOR UPDATE TO authenticated
  USING (
    public.library_user_can_access_branch(auth.uid(), branch_id, 'catalog')
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'circulate')
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'inventory')
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings')
  )
  WITH CHECK (
    public.library_user_can_access_branch(auth.uid(), branch_id, 'catalog')
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'circulate')
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'inventory')
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings')
  );

DROP POLICY IF EXISTS "Library staff delete items" ON public.library_items;
CREATE POLICY "Library staff delete items" ON public.library_items
  FOR DELETE TO authenticated
  USING (
    public.library_user_can_access_branch(auth.uid(), branch_id, 'catalog')
    OR public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings')
  );

DROP POLICY IF EXISTS "Library staff manage members" ON public.library_members;
CREATE POLICY "Library staff manage members" ON public.library_members
  FOR ALL TO authenticated
  USING (
    public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
  )
  WITH CHECK (
    public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
  );

DROP POLICY IF EXISTS "Library staff circulate loans" ON public.library_loans;
CREATE POLICY "Library staff circulate loans" ON public.library_loans
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.library_items i
      WHERE i.id = library_loans.item_id
        AND public.library_user_can_access_branch(auth.uid(), i.branch_id, 'circulate')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.library_items i
      WHERE i.id = library_loans.item_id
        AND public.library_user_can_access_branch(auth.uid(), i.branch_id, 'circulate')
    )
  );

DROP POLICY IF EXISTS "Library staff manage holds" ON public.library_holds;
CREATE POLICY "Library staff manage holds" ON public.library_holds
  FOR UPDATE TO authenticated
  USING (
    public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
  )
  WITH CHECK (
    public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
  );

DROP POLICY IF EXISTS "Library staff manage fines" ON public.library_fines;
CREATE POLICY "Library staff manage fines" ON public.library_fines
  FOR ALL TO authenticated
  USING (
    public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
  )
  WITH CHECK (
    public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
  );

DROP POLICY IF EXISTS "Library staff view digitization batches" ON public.library_digitization_batches;
CREATE POLICY "Library staff view digitization batches" ON public.library_digitization_batches
  FOR SELECT TO authenticated
  USING (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize'));

DROP POLICY IF EXISTS "Library staff manage digitization batches" ON public.library_digitization_batches;
CREATE POLICY "Library staff manage digitization batches" ON public.library_digitization_batches
  FOR ALL TO authenticated
  USING (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize'))
  WITH CHECK (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize'));

DROP POLICY IF EXISTS "Library staff view digitization records" ON public.library_digitization_records;
CREATE POLICY "Library staff view digitization records" ON public.library_digitization_records
  FOR SELECT TO authenticated
  USING (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize'));

DROP POLICY IF EXISTS "Library staff manage digitization records" ON public.library_digitization_records;
CREATE POLICY "Library staff manage digitization records" ON public.library_digitization_records
  FOR ALL TO authenticated
  USING (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize'))
  WITH CHECK (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize'));

DROP POLICY IF EXISTS "Library managers maintain settings" ON public.library_settings;
CREATE POLICY "Library managers maintain settings" ON public.library_settings
  FOR ALL TO authenticated
  USING (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'))
  WITH CHECK (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'));

DROP POLICY IF EXISTS "Library managers view audit events" ON public.library_audit_events;
CREATE POLICY "Library managers view audit events" ON public.library_audit_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'view'))
  );

DROP POLICY IF EXISTS "Library staff insert audit events" ON public.library_audit_events;
CREATE POLICY "Library staff insert audit events" ON public.library_audit_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (branch_id IS NOT NULL AND public.library_user_can_access_branch(auth.uid(), branch_id, 'view'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_staff_assignments TO authenticated;
GRANT ALL ON public.library_staff_assignments TO service_role;
GRANT EXECUTE ON FUNCTION public.library_user_can_create_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_user_can_access_branch(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_user_has_any_assignment(uuid, text) TO authenticated;
