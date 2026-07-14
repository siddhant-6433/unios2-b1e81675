-- Academic partner onboarding details and internal-only documents.

ALTER TABLE public.academic_partners
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS pan_number text,
  ADD COLUMN IF NOT EXISTS gst_number text,
  ADD COLUMN IF NOT EXISTS authorised_signatory_name text,
  ADD COLUMN IF NOT EXISTS authorised_signatory_contact text,
  ADD COLUMN IF NOT EXISTS authorised_signatory_email text,
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'skipped', 'completed')),
  ADD COLUMN IF NOT EXISTS onboarding_step integer NOT NULL DEFAULT 0 CHECK (onboarding_step >= 0),
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.academic_partner_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.academic_partners(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (
    document_type IN ('agreement', 'gst', 'pan', 'fee_structure', 'brochure', 'additional')
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

CREATE INDEX IF NOT EXISTS idx_academic_partner_documents_partner
  ON public.academic_partner_documents(partner_id, created_at DESC);

ALTER TABLE public.academic_partner_documents ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('academic-partner-documents', 'academic-partner-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Admins read academic partner documents" ON public.academic_partner_documents;
CREATE POLICY "Admins read academic partner documents"
  ON public.academic_partner_documents FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Admins manage academic partner documents" ON public.academic_partner_documents;
CREATE POLICY "Admins manage academic partner documents"
  ON public.academic_partner_documents FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Academic partners insert own internal documents" ON public.academic_partner_documents;
CREATE POLICY "Academic partners insert own internal documents"
  ON public.academic_partner_documents FOR INSERT TO authenticated
  WITH CHECK (
    visibility = 'internal'
    AND partner_id IN (SELECT id FROM public.academic_partners WHERE user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.save_academic_partner_onboarding(
  _partner_id uuid,
  _company_name text DEFAULT NULL,
  _company_address text DEFAULT NULL,
  _pan_number text DEFAULT NULL,
  _gst_number text DEFAULT NULL,
  _authorised_signatory_name text DEFAULT NULL,
  _authorised_signatory_contact text DEFAULT NULL,
  _authorised_signatory_email text DEFAULT NULL,
  _onboarding_status text DEFAULT 'in_progress',
  _onboarding_step integer DEFAULT 0
)
RETURNS public.academic_partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner public.academic_partners;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _onboarding_status NOT IN ('not_started', 'in_progress', 'skipped', 'completed') THEN
    RAISE EXCEPTION 'Invalid onboarding status';
  END IF;

  UPDATE public.academic_partners
  SET
    company_name = NULLIF(trim(_company_name), ''),
    company_address = NULLIF(trim(_company_address), ''),
    pan_number = NULLIF(upper(trim(_pan_number)), ''),
    gst_number = NULLIF(upper(trim(_gst_number)), ''),
    authorised_signatory_name = NULLIF(trim(_authorised_signatory_name), ''),
    authorised_signatory_contact = NULLIF(trim(_authorised_signatory_contact), ''),
    authorised_signatory_email = NULLIF(lower(trim(_authorised_signatory_email)), ''),
    onboarding_status = _onboarding_status,
    onboarding_step = GREATEST(COALESCE(_onboarding_step, 0), 0),
    onboarding_skipped_at = CASE WHEN _onboarding_status = 'skipped' THEN now() ELSE onboarding_skipped_at END,
    onboarding_completed_at = CASE WHEN _onboarding_status = 'completed' THEN now() ELSE onboarding_completed_at END,
    updated_at = now()
  WHERE id = _partner_id
    AND user_id = auth.uid()
  RETURNING * INTO v_partner;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academic partner profile not found';
  END IF;

  RETURN v_partner;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_academic_partner_onboarding(
  uuid, text, text, text, text, text, text, text, text, integer
) TO authenticated;

DROP POLICY IF EXISTS "Admins read academic partner document files" ON storage.objects;
CREATE POLICY "Admins read academic partner document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'academic-partner-documents'
    AND (
      public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'campus_admin'::app_role)
      OR public.has_role(auth.uid(), 'admission_head'::app_role)
    )
  );

DROP POLICY IF EXISTS "Academic partners upload own document files" ON storage.objects;
CREATE POLICY "Academic partners upload own document files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'academic-partner-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.academic_partners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage academic partner document files" ON storage.objects;
CREATE POLICY "Admins manage academic partner document files"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'academic-partner-documents'
    AND (
      public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'campus_admin'::app_role)
      OR public.has_role(auth.uid(), 'admission_head'::app_role)
    )
  )
  WITH CHECK (
    bucket_id = 'academic-partner-documents'
    AND (
      public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'campus_admin'::app_role)
      OR public.has_role(auth.uid(), 'admission_head'::app_role)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_partner_documents TO authenticated;
