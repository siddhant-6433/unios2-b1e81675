-- Face registration for attendance verification
CREATE TABLE IF NOT EXISTS employee_face_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  image_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE employee_face_registrations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_face_registrations TO authenticated;

CREATE POLICY "Users can view own face registration"
  ON employee_face_registrations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can insert own face registration"
  ON employee_face_registrations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pending registration"
  ON employee_face_registrations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can manage face registrations"
  ON employee_face_registrations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Storage bucket for selfies
INSERT INTO storage.buckets (id, name, public)
VALUES ('selfies', 'selfies', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload own selfies"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'selfies' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view own selfies"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'selfies' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Admins can view all selfies"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'selfies' AND public.has_role(auth.uid(), 'super_admin'));
