-- Consultant onboarding details and internal-only documents.

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS pan_number text,
  ADD COLUMN IF NOT EXISTS gst_number text,
  ADD COLUMN IF NOT EXISTS tan_number text,
  ADD COLUMN IF NOT EXISTS authorised_signatory_name text,
  ADD COLUMN IF NOT EXISTS authorised_signatory_contact text,
  ADD COLUMN IF NOT EXISTS authorised_signatory_email text,
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'skipped', 'completed')),
  ADD COLUMN IF NOT EXISTS onboarding_step integer NOT NULL DEFAULT 0 CHECK (onboarding_step >= 0),
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.consultant_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (
    document_type IN ('agreement', 'gst', 'pan', 'tan', 'bank_details', 'fee_structure', 'brochure', 'additional')
  ),
  title text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  content_type text,
  file_size_bytes bigint,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility = 'internal'),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultant_documents_consultant
  ON public.consultant_documents(consultant_id, created_at DESC);

ALTER TABLE public.consultant_documents ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('consultant-documents', 'consultant-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE OR REPLACE FUNCTION public.can_access_consultant_onboarding(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin'::app_role)
    OR (
      (
        public.has_role(_user_id, 'principal'::app_role)
        OR public.has_role(_user_id, 'counsellor'::app_role)
      )
      AND 'consultants:view' = ANY(public.get_user_permissions(_user_id))
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_consultant_onboarding(uuid) TO authenticated;

DROP POLICY IF EXISTS "Internal users read consultant documents" ON public.consultant_documents;
CREATE POLICY "Internal users read consultant documents"
  ON public.consultant_documents FOR SELECT TO authenticated
  USING (public.can_access_consultant_onboarding(auth.uid()));

DROP POLICY IF EXISTS "Internal users manage consultant documents" ON public.consultant_documents;
CREATE POLICY "Internal users manage consultant documents"
  ON public.consultant_documents FOR ALL TO authenticated
  USING (public.can_access_consultant_onboarding(auth.uid()))
  WITH CHECK (public.can_access_consultant_onboarding(auth.uid()));

DROP POLICY IF EXISTS "Consultants insert own internal documents" ON public.consultant_documents;
CREATE POLICY "Consultants insert own internal documents"
  ON public.consultant_documents FOR INSERT TO authenticated
  WITH CHECK (
    visibility = 'internal'
    AND consultant_id IN (SELECT id FROM public.consultants WHERE user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.save_consultant_onboarding(
  _consultant_id uuid,
  _company_name text DEFAULT NULL,
  _company_address text DEFAULT NULL,
  _pan_number text DEFAULT NULL,
  _gst_number text DEFAULT NULL,
  _tan_number text DEFAULT NULL,
  _authorised_signatory_name text DEFAULT NULL,
  _authorised_signatory_contact text DEFAULT NULL,
  _authorised_signatory_email text DEFAULT NULL,
  _onboarding_status text DEFAULT 'in_progress',
  _onboarding_step integer DEFAULT 0
)
RETURNS public.consultants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consultant public.consultants;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _onboarding_status NOT IN ('not_started', 'in_progress', 'skipped', 'completed') THEN
    RAISE EXCEPTION 'Invalid onboarding status';
  END IF;

  UPDATE public.consultants
  SET
    company_name = NULLIF(trim(_company_name), ''),
    company_address = NULLIF(trim(_company_address), ''),
    pan_number = NULLIF(upper(trim(_pan_number)), ''),
    gst_number = NULLIF(upper(trim(_gst_number)), ''),
    tan_number = NULLIF(upper(trim(_tan_number)), ''),
    authorised_signatory_name = NULLIF(trim(_authorised_signatory_name), ''),
    authorised_signatory_contact = NULLIF(trim(_authorised_signatory_contact), ''),
    authorised_signatory_email = NULLIF(lower(trim(_authorised_signatory_email)), ''),
    onboarding_status = _onboarding_status,
    onboarding_step = GREATEST(COALESCE(_onboarding_step, 0), 0),
    onboarding_skipped_at = CASE WHEN _onboarding_status = 'skipped' THEN now() ELSE onboarding_skipped_at END,
    onboarding_completed_at = CASE WHEN _onboarding_status = 'completed' THEN now() ELSE onboarding_completed_at END,
    updated_at = now()
  WHERE id = _consultant_id
    AND user_id = auth.uid()
  RETURNING * INTO v_consultant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultant profile not found';
  END IF;

  RETURN v_consultant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_consultant_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, integer
) TO authenticated;

DROP POLICY IF EXISTS "Internal users read consultant document files" ON storage.objects;
CREATE POLICY "Internal users read consultant document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'consultant-documents'
    AND public.can_access_consultant_onboarding(auth.uid())
  );

DROP POLICY IF EXISTS "Consultants upload own document files" ON storage.objects;
CREATE POLICY "Consultants upload own document files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'consultant-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.consultants WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Internal users manage consultant document files" ON storage.objects;
CREATE POLICY "Internal users manage consultant document files"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'consultant-documents'
    AND public.can_access_consultant_onboarding(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'consultant-documents'
    AND public.can_access_consultant_onboarding(auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_documents TO authenticated;
