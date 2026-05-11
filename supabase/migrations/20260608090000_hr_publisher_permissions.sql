-- HR module permissions (hr:view gates all /hr/* routes)
INSERT INTO public.permissions (module, action, description) VALUES
  ('hr', 'view',             'Access HR section'),
  ('hr', 'employees_edit',   'Edit employee records'),
  ('hr', 'attendance_edit',  'Edit HR attendance records'),
  ('hr', 'leave_approve',    'Approve or reject leave requests'),
  ('hr', 'recruitment_edit', 'Manage job applicants / recruitment'),
  ('publisher_portal', 'view', 'Access publisher portal')
ON CONFLICT (module, action) DO NOTHING;

-- Seed HR access
DO $$
DECLARE v_perm_id uuid;
BEGIN
  -- campus_admin + principal: full HR
  FOR v_perm_id IN SELECT id FROM public.permissions WHERE module = 'hr' LOOP
    INSERT INTO public.role_permissions (role, permission_id)
    VALUES ('campus_admin'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    INSERT INTO public.role_permissions (role, permission_id)
    VALUES ('principal'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- office_admin: view access only
  SELECT id INTO v_perm_id FROM public.permissions WHERE module = 'hr' AND action = 'view';
  INSERT INTO public.role_permissions (role, permission_id)
  VALUES ('office_admin'::app_role, v_perm_id) ON CONFLICT DO NOTHING;

  -- publisher role: publisher_portal:view
  SELECT id INTO v_perm_id FROM public.permissions WHERE module = 'publisher_portal' AND action = 'view';
  INSERT INTO public.role_permissions (role, permission_id)
  VALUES ('publisher'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  -- campus_admin + principal can also see publisher portal
  INSERT INTO public.role_permissions (role, permission_id)
  VALUES ('campus_admin'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.role_permissions (role, permission_id)
  VALUES ('principal'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
END $$;
