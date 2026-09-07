-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260730101736 name=hr_employee_documents applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  doc_key            text NOT NULL,
  file_path          text NOT NULL,
  file_url           text NOT NULL,
  file_name          text NOT NULL,
  original_file_name text,
  mime_type          text,
  file_size          integer,
  storage_provider   text NOT NULL DEFAULT 'r2' CHECK (storage_provider IN ('r2','supabase')),
  uploaded_source    text NOT NULL DEFAULT 'hr' CHECK (uploaded_source IN ('careers_portal','hr','system')),
  uploaded_by        uuid REFERENCES auth.users(id),
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, doc_key)
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
  ON public.employee_documents (employee_id);

DROP TRIGGER IF EXISTS update_employee_documents_updated_at ON public.employee_documents;
CREATE TRIGGER update_employee_documents_updated_at
  BEFORE UPDATE ON public.employee_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR and owner read employee documents" ON public.employee_documents;
CREATE POLICY "HR and owner read employee documents"
  ON public.employee_documents FOR SELECT TO authenticated
  USING (
    'hr:view' = ANY(public.get_user_permissions(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.employee_profiles e
      WHERE e.id = employee_id AND e.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "HR manages employee documents" ON public.employee_documents;
CREATE POLICY "HR manages employee documents"
  ON public.employee_documents FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:employees_edit' = ANY(public.get_user_permissions(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR 'hr:employees_edit' = ANY(public.get_user_permissions(auth.uid()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_documents TO authenticated;
GRANT ALL ON public.employee_documents TO service_role;
