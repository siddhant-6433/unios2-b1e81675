-- Tighten branch-scoped library staff permissions after introducing assignments.

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
    OR (
      (
        public.has_role(_user_id, 'campus_admin'::public.app_role)
        OR public.has_role(_user_id, 'principal'::public.app_role)
      )
      AND _action IN ('view', 'manage_settings', 'export')
    )
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

DROP POLICY IF EXISTS "Library managers maintain branches" ON public.library_branches;

DROP POLICY IF EXISTS "Library administrators create branches" ON public.library_branches;
CREATE POLICY "Library administrators create branches" ON public.library_branches
  FOR INSERT TO authenticated
  WITH CHECK (public.library_user_can_create_branch(auth.uid(), campus_id));

DROP POLICY IF EXISTS "Library managers update branches" ON public.library_branches;
CREATE POLICY "Library managers update branches" ON public.library_branches
  FOR UPDATE TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), id, 'manage_settings'))
  WITH CHECK (public.library_user_can_access_branch(auth.uid(), id, 'manage_settings'));

DROP POLICY IF EXISTS "Library managers delete branches" ON public.library_branches;
CREATE POLICY "Library managers delete branches" ON public.library_branches
  FOR DELETE TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), id, 'manage_settings'));
