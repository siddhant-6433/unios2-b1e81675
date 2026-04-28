-- Allow super_admin to delete face registrations
DROP POLICY IF EXISTS "admin_face_delete" ON employee_face_registrations;
CREATE POLICY "admin_face_delete"
  ON employee_face_registrations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
