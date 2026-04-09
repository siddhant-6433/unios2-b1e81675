-- =====================================================
-- Seed permissions + default role mappings
-- Matches current hardcoded sidebar access exactly
-- =====================================================

-- 1. Insert all module:action permissions
INSERT INTO public.permissions (module, action, description) VALUES
  -- Main menu
  ('dashboard', 'view', 'View dashboard/overview'),
  ('search', 'view', 'Search leads and students'),
  ('students', 'view', 'View student list'),
  ('students', 'create', 'Add new students'),
  ('students', 'edit', 'Edit student details'),
  ('students', 'delete', 'Delete students'),
  ('students', 'export', 'Export student data'),
  ('attendance', 'view', 'View attendance'),
  ('attendance', 'create', 'Mark attendance'),
  ('attendance', 'edit', 'Edit attendance records'),
  ('exams', 'view', 'View exam results'),
  ('exams', 'create', 'Create exams'),
  ('exams', 'edit', 'Edit exam results'),
  ('finance', 'view', 'View finance/fee data'),
  ('finance', 'create', 'Record payments'),
  ('finance', 'edit', 'Edit fee records'),
  ('finance', 'delete', 'Delete fee records'),
  ('finance', 'export', 'Export finance data'),
  ('reports', 'view', 'View reports'),
  ('reports', 'export', 'Export reports'),

  -- Admissions
  ('leads', 'view', 'View leads list'),
  ('leads', 'create', 'Add new leads'),
  ('leads', 'edit', 'Edit lead details'),
  ('leads', 'delete', 'Delete leads'),
  ('leads', 'export', 'Export leads data'),
  ('whatsapp', 'view', 'View WhatsApp inbox'),
  ('whatsapp', 'send', 'Send WhatsApp messages'),
  ('performance', 'view', 'View counsellor performance'),
  ('lead_buckets', 'view', 'View lead buckets'),
  ('lead_allocation', 'view', 'View lead allocation'),
  ('lead_allocation', 'edit', 'Allocate/transfer leads'),
  ('automation', 'view', 'View automation rules'),
  ('automation', 'create', 'Create automation rules'),
  ('automation', 'edit', 'Edit automation rules'),
  ('automation', 'delete', 'Delete automation rules'),
  ('consultants', 'view', 'View consultants'),
  ('consultants', 'create', 'Add consultants'),
  ('consultants', 'edit', 'Edit consultant details'),
  ('templates', 'view', 'View templates'),
  ('templates', 'create', 'Create templates'),
  ('templates', 'edit', 'Edit templates'),
  ('templates', 'delete', 'Delete templates'),
  ('courses_fees', 'view', 'View courses & fee structures'),
  ('courses_fees', 'edit', 'Edit fee structures'),
  ('consultant_portal', 'view', 'View consultant portal'),
  ('analytics', 'view', 'View admission analytics'),

  -- IB Academics
  ('ib_poi', 'view', 'View Programme of Inquiry'),
  ('ib_poi', 'create', 'Create POI entries'),
  ('ib_poi', 'edit', 'Edit POI entries'),
  ('ib_units', 'view', 'View unit planner'),
  ('ib_units', 'create', 'Create units'),
  ('ib_units', 'edit', 'Edit units'),
  ('ib_gradebook', 'view', 'View gradebook'),
  ('ib_gradebook', 'edit', 'Edit grades'),
  ('ib_portfolios', 'view', 'View student portfolios'),
  ('ib_portfolios', 'create', 'Create portfolio entries'),
  ('ib_action', 'view', 'View action & service'),
  ('ib_action', 'create', 'Create action entries'),
  ('ib_reports', 'view', 'View IB report cards'),
  ('ib_reports', 'create', 'Generate report cards'),
  ('ib_exhibition', 'view', 'View exhibition'),
  ('ib_exhibition', 'create', 'Create exhibition entries'),
  ('ib_projects', 'view', 'View MYP projects'),
  ('ib_projects', 'create', 'Create MYP projects'),
  ('ib_idu', 'view', 'View IDU'),
  ('ib_idu', 'create', 'Create IDU entries'),

  -- Management
  ('campuses_courses', 'view', 'View campuses & courses admin'),
  ('campuses_courses', 'edit', 'Edit campuses & courses'),
  ('documents', 'view', 'View documents'),
  ('documents', 'upload', 'Upload documents'),
  ('documents', 'delete', 'Delete documents'),
  ('user_management', 'view', 'View user management'),
  ('user_management', 'create', 'Create users'),
  ('user_management', 'edit', 'Edit user roles'),
  ('user_management', 'delete', 'Delete users'),
  ('permissions', 'view', 'View permission settings'),
  ('permissions', 'edit', 'Edit permissions')
ON CONFLICT (module, action) DO NOTHING;

-- 2. Helper: insert role_permission by module:action
-- We use a DO block for cleaner bulk inserts

DO $$
DECLARE
  -- Staff roles (everyone except student, parent, consultant)
  v_staff text[] := ARRAY['campus_admin','principal','admission_head','counsellor','accountant','faculty','teacher','data_entry','office_assistant','hostel_warden','ib_coordinator'];
  v_admin text[] := ARRAY['campus_admin','principal'];
  v_role text;
  v_perm_id uuid;
BEGIN

  -- Helper function for this block
  -- Insert a role-permission mapping
  FOR v_role IN SELECT unnest(v_staff) LOOP
    -- dashboard:view for all staff
    SELECT id INTO v_perm_id FROM permissions WHERE module='dashboard' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;

    -- search:view for all staff
    SELECT id INTO v_perm_id FROM permissions WHERE module='search' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;

    -- students:view for all staff
    SELECT id INTO v_perm_id FROM permissions WHERE module='students' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;

    -- documents:view for all staff
    SELECT id INTO v_perm_id FROM permissions WHERE module='documents' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    SELECT id INTO v_perm_id FROM permissions WHERE module='documents' AND action='upload';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Attendance: all staff + student + parent
  FOR v_role IN SELECT unnest(v_staff || ARRAY['student','parent']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='attendance' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Exams: all staff + student + parent
  FOR v_role IN SELECT unnest(v_staff || ARRAY['student','parent']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='exams' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Dashboard for student + parent
  FOR v_role IN SELECT unnest(ARRAY['student','parent']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='dashboard' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Finance: admin + accountant
  FOR v_role IN SELECT unnest(v_admin || ARRAY['accountant']) LOOP
    FOR v_perm_id IN SELECT id FROM permissions WHERE module='finance' LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Reports: admin only
  FOR v_role IN SELECT unnest(v_admin) LOOP
    FOR v_perm_id IN SELECT id FROM permissions WHERE module='reports' LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Leads: admin + admission_head + counsellor + data_entry
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head','counsellor','data_entry']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='leads' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    SELECT id INTO v_perm_id FROM permissions WHERE module='leads' AND action='create';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    SELECT id INTO v_perm_id FROM permissions WHERE module='leads' AND action='edit';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Leads delete/export: admin + admission_head only
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='leads' AND action='delete';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    SELECT id INTO v_perm_id FROM permissions WHERE module='leads' AND action='export';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- WhatsApp: admin + admission_head + counsellor
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head','counsellor']) LOOP
    FOR v_perm_id IN SELECT id FROM permissions WHERE module='whatsapp' LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Performance: admin + admission_head
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='performance' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Lead buckets: admin + admission_head + counsellor
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head','counsellor']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='lead_buckets' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Lead allocation: super_admin handled by code shortcut, admission_head
  SELECT id INTO v_perm_id FROM permissions WHERE module='lead_allocation' AND action='view';
  INSERT INTO role_permissions (role, permission_id) VALUES ('admission_head'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  SELECT id INTO v_perm_id FROM permissions WHERE module='lead_allocation' AND action='edit';
  INSERT INTO role_permissions (role, permission_id) VALUES ('admission_head'::app_role, v_perm_id) ON CONFLICT DO NOTHING;

  -- Automation: admission_head
  FOR v_perm_id IN SELECT id FROM permissions WHERE module='automation' LOOP
    INSERT INTO role_permissions (role, permission_id) VALUES ('admission_head'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Consultants: admin + admission_head + counsellor
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head','counsellor']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='consultants' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Templates: admission_head
  FOR v_perm_id IN SELECT id FROM permissions WHERE module='templates' LOOP
    INSERT INTO role_permissions (role, permission_id) VALUES ('admission_head'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Courses & Fees: admin + admission_head + counsellor + consultant
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head','counsellor','consultant']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='courses_fees' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Consultant portal
  SELECT id INTO v_perm_id FROM permissions WHERE module='consultant_portal' AND action='view';
  INSERT INTO role_permissions (role, permission_id) VALUES ('consultant'::app_role, v_perm_id) ON CONFLICT DO NOTHING;

  -- Analytics: admin + admission_head
  FOR v_role IN SELECT unnest(v_admin || ARRAY['admission_head']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='analytics' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- IB Academics: admin + ib_coordinator + faculty + teacher
  FOR v_role IN SELECT unnest(v_admin || ARRAY['ib_coordinator','faculty','teacher']) LOOP
    FOR v_perm_id IN SELECT id FROM permissions WHERE module IN ('ib_poi','ib_units','ib_gradebook','ib_exhibition','ib_idu') LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- IB Portfolios: above + student + parent
  FOR v_role IN SELECT unnest(v_admin || ARRAY['ib_coordinator','faculty','teacher','student','parent']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='ib_portfolios' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- IB Action & Service: above + student (no parent)
  FOR v_role IN SELECT unnest(v_admin || ARRAY['ib_coordinator','faculty','teacher','student']) LOOP
    FOR v_perm_id IN SELECT id FROM permissions WHERE module='ib_action' LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- IB Reports: above + student + parent
  FOR v_role IN SELECT unnest(v_admin || ARRAY['ib_coordinator','faculty','teacher','student','parent']) LOOP
    SELECT id INTO v_perm_id FROM permissions WHERE module='ib_reports' AND action='view';
    INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- IB Projects: above + student (no parent)
  FOR v_role IN SELECT unnest(v_admin || ARRAY['ib_coordinator','faculty','teacher','student']) LOOP
    FOR v_perm_id IN SELECT id FROM permissions WHERE module='ib_projects' LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Campuses & Courses: admin
  FOR v_role IN SELECT unnest(v_admin) LOOP
    FOR v_perm_id IN SELECT id FROM permissions WHERE module='campuses_courses' LOOP
      INSERT INTO role_permissions (role, permission_id) VALUES (v_role::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

END $$;
