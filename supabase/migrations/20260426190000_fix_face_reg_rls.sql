-- Fix face registration RLS - ensure super_admin can read all
DROP POLICY IF EXISTS "Users can view own face registration" ON employee_face_registrations;
DROP POLICY IF EXISTS "Admins can manage face registrations" ON employee_face_registrations;

-- Everyone can read their own
CREATE POLICY "own_face_read"
  ON employee_face_registrations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Super admin can read all
CREATE POLICY "admin_face_read"
  ON employee_face_registrations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Super admin can update (approve/reject)
CREATE POLICY "admin_face_update"
  ON employee_face_registrations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Users can insert their own
DROP POLICY IF EXISTS "Users can insert own face registration" ON employee_face_registrations;
CREATE POLICY "own_face_insert"
  ON employee_face_registrations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update own pending
DROP POLICY IF EXISTS "Users can update own pending registration" ON employee_face_registrations;
CREATE POLICY "own_face_update"
  ON employee_face_registrations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');
