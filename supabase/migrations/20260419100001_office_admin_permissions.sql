-- Grant alumni_verification permissions to office_admin role
DO $$
DECLARE
  perm_id uuid;
BEGIN
  -- alumni_verification:view
  SELECT id INTO perm_id FROM permissions WHERE module = 'alumni_verification' AND action = 'view';
  IF perm_id IS NOT NULL THEN
    INSERT INTO role_permissions (role, permission_id)
    VALUES ('office_admin', perm_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- alumni_verification:manage
  SELECT id INTO perm_id FROM permissions WHERE module = 'alumni_verification' AND action = 'manage';
  IF perm_id IS NOT NULL THEN
    INSERT INTO role_permissions (role, permission_id)
    VALUES ('office_admin', perm_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
