CREATE TABLE IF NOT EXISTS public.application_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text NOT NULL,
  doc_key text NOT NULL,
  file_path text NOT NULL,
  file_url text NOT NULL,
  file_name text NOT NULL,
  original_file_name text,
  mime_type text,
  file_size integer,
  storage_provider text NOT NULL DEFAULT 'r2' CHECK (storage_provider IN ('r2', 'supabase')),
  uploaded_source text NOT NULL DEFAULT 'apply_portal' CHECK (uploaded_source IN ('apply_portal', 'admin', 'system')),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, doc_key)
);

CREATE INDEX IF NOT EXISTS idx_application_documents_application_id
  ON public.application_documents(application_id);

ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff view application documents" ON public.application_documents;
CREATE POLICY "staff view application documents"
  ON public.application_documents FOR SELECT TO authenticated
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

GRANT SELECT ON public.application_documents TO authenticated;
GRANT ALL ON public.application_documents TO service_role;

CREATE OR REPLACE FUNCTION public._application_documents_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_documents_updated_at ON public.application_documents;
CREATE TRIGGER trg_application_documents_updated_at
  BEFORE UPDATE ON public.application_documents
  FOR EACH ROW EXECUTE FUNCTION public._application_documents_touch_updated_at();
