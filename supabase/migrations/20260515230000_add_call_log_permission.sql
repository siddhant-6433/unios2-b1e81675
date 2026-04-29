-- Add call_log permission (was missing from seeds — Cloud Dialer, Fresh Leads,
-- Pending Follow-ups, and Call Log were invisible to non-super_admin roles)
INSERT INTO public.permissions (module, action, description) VALUES
  ('call_log', 'view', 'View call log, cloud dialer, fresh leads, pending follow-ups')
ON CONFLICT (module, action) DO NOTHING;

-- Grant to counsellor, admission_head, campus_admin, data_entry
DO $$
DECLARE
  v_perm_id uuid;
  v_role text;
BEGIN
  SELECT id INTO v_perm_id FROM permissions WHERE module = 'call_log' AND action = 'view';
  IF v_perm_id IS NOT NULL THEN
    FOR v_role IN SELECT unnest(ARRAY['counsellor', 'admission_head', 'campus_admin', 'principal', 'data_entry']) LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
END $$;
