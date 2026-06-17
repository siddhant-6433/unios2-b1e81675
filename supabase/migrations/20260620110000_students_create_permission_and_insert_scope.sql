-- "Add Student" button was hidden for principal & office_assistant because the
-- `students:create` permission is granted to NO role (only `students:view` is
-- seeded). The button is gated by can("students","create"); super_admin sees it
-- only via the can() short-circuit. Grant create to principal + office_assistant.
--
-- Separately, the INSERT RLS policy allowed principal (UNSCOPED) but not
-- office_assistant at all. Per product decision, both principal and
-- office_assistant may add students ONLY for their own assigned campus. Recreate
-- the policy so both branches are campus-scoped via user_can_access_assigned_campus,
-- while preserving every other role's existing (unscoped) insert capability.

-- 1. Permission grants (button visibility) --------------------------------------
INSERT INTO public.role_permissions (role, permission_id)
SELECT r.role, p.id
FROM (VALUES ('principal'::app_role), ('office_assistant'::app_role)) AS r(role)
JOIN public.permissions p ON p.module = 'students' AND p.action = 'create'
ON CONFLICT DO NOTHING;

-- 2. Campus-scoped insert policy (actual write capability) -----------------------
DROP POLICY IF EXISTS "Staff can insert students" ON public.students;
CREATE POLICY "Staff can insert students" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')    OR
    public.has_role(auth.uid(), 'campus_admin')   OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')     OR
    public.has_role(auth.uid(), 'accountant')     OR
    public.has_role(auth.uid(), 'data_entry')     OR
    public.has_role(auth.uid(), 'office_admin')   OR
    (
      public.has_role(auth.uid(), 'principal')
      AND public.user_can_access_assigned_campus(auth.uid(), students.campus_id)
    ) OR
    (
      public.has_role(auth.uid(), 'office_assistant')
      AND public.user_can_access_assigned_campus(auth.uid(), students.campus_id)
    )
  );
