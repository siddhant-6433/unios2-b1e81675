-- Academic partner dashboard logos.

ALTER TABLE public.academic_partners
  ADD COLUMN IF NOT EXISTS logo_file_path text,
  ADD COLUMN IF NOT EXISTS logo_uploaded_at timestamptz;

INSERT INTO storage.buckets (id, name, public)
VALUES ('academic-partner-logos', 'academic-partner-logos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE OR REPLACE FUNCTION public.save_academic_partner_logo(
  _partner_id uuid,
  _logo_file_path text
)
RETURNS public.academic_partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner public.academic_partners;
  v_logo_path text := NULLIF(trim(_logo_file_path), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.academic_partners
  SET
    logo_file_path = v_logo_path,
    logo_uploaded_at = CASE WHEN v_logo_path IS NULL THEN NULL ELSE now() END,
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

GRANT EXECUTE ON FUNCTION public.save_academic_partner_logo(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Admins read academic partner logo files" ON storage.objects;
CREATE POLICY "Admins read academic partner logo files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'academic-partner-logos'
    AND (
      public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'campus_admin'::app_role)
      OR public.has_role(auth.uid(), 'admission_head'::app_role)
    )
  );

DROP POLICY IF EXISTS "Admins manage academic partner logo files" ON storage.objects;
CREATE POLICY "Admins manage academic partner logo files"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'academic-partner-logos'
    AND (
      public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'campus_admin'::app_role)
      OR public.has_role(auth.uid(), 'admission_head'::app_role)
    )
  )
  WITH CHECK (
    bucket_id = 'academic-partner-logos'
    AND (
      public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'campus_admin'::app_role)
      OR public.has_role(auth.uid(), 'admission_head'::app_role)
    )
  );

DROP POLICY IF EXISTS "Academic partners read own logo files" ON storage.objects;
CREATE POLICY "Academic partners read own logo files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'academic-partner-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.academic_partners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Academic partners upload own logo files" ON storage.objects;
CREATE POLICY "Academic partners upload own logo files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'academic-partner-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.academic_partners WHERE user_id = auth.uid()
    )
  );
