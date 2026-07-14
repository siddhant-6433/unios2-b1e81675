CREATE TABLE IF NOT EXISTS public.student_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_audit_log_student_id_created_at
  ON public.student_audit_log(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_audit_log_event_type
  ON public.student_audit_log(event_type);

ALTER TABLE public.student_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read student_audit_log" ON public.student_audit_log;
CREATE POLICY "Staff can read student_audit_log"
  ON public.student_audit_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    public.has_role(auth.uid(), 'office_assistant')
  );

DROP POLICY IF EXISTS "Staff can insert student_audit_log" ON public.student_audit_log;
CREATE POLICY "Staff can insert student_audit_log"
  ON public.student_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    public.has_role(auth.uid(), 'office_assistant')
  );

GRANT SELECT, INSERT ON public.student_audit_log TO authenticated;
GRANT ALL ON public.student_audit_log TO service_role;
