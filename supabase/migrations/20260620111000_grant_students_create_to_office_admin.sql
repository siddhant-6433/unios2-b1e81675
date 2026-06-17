-- Office administrators already pass the students INSERT RLS policy, but the
-- "Add Student" button is hidden unless the role has students:create.

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'office_admin'::app_role, p.id
FROM public.permissions p
WHERE p.module = 'students'
  AND p.action = 'create'
ON CONFLICT DO NOTHING;
