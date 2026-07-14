-- Allow principals to record counselling registration details.
--
-- The sprint pages already treat principals as admissions approvers, but the
-- CAHET / UPDELED registration storage policies and mark-registered RPCs only
-- allowed super_admin, campus_admin, admission_head, and counsellor. This kept
-- principals from saving registration numbers or proof files.

-- ========== CAHET storage ==========

DROP POLICY IF EXISTS "Staff can upload cahet docs" ON storage.objects;
CREATE POLICY "Staff can upload cahet docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cahet-registrations' AND (
      public.has_role(auth.uid(), 'super_admin') OR
      public.has_role(auth.uid(), 'campus_admin') OR
      public.has_role(auth.uid(), 'principal') OR
      public.has_role(auth.uid(), 'admission_head') OR
      public.has_role(auth.uid(), 'counsellor')
    )
  );

DROP POLICY IF EXISTS "Staff can view cahet docs" ON storage.objects;
CREATE POLICY "Staff can view cahet docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cahet-registrations' AND (
      public.has_role(auth.uid(), 'super_admin') OR
      public.has_role(auth.uid(), 'campus_admin') OR
      public.has_role(auth.uid(), 'principal') OR
      public.has_role(auth.uid(), 'admission_head') OR
      public.has_role(auth.uid(), 'counsellor')
    )
  );

-- ========== CAHET table ==========

DROP POLICY IF EXISTS "Staff can view cahet registrations" ON public.cahet_registrations;
CREATE POLICY "Staff can view cahet registrations"
  ON public.cahet_registrations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Staff can insert cahet registrations" ON public.cahet_registrations;
CREATE POLICY "Staff can insert cahet registrations"
  ON public.cahet_registrations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Staff can update cahet registrations" ON public.cahet_registrations;
CREATE POLICY "Staff can update cahet registrations"
  ON public.cahet_registrations FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head')
  );

CREATE OR REPLACE FUNCTION public.cahet_mark_registered(
  p_lead_id uuid,
  p_registration_no text,
  p_document_url text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.cahet_registrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.cahet_registrations;
  v_profile_id uuid;
BEGIN
  IF p_lead_id IS NULL OR p_registration_no IS NULL OR length(trim(p_registration_no)) = 0 THEN
    RAISE EXCEPTION 'lead_id and registration_no are required';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  ) THEN
    RAISE EXCEPTION 'not authorized to mark cahet registrations';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid();

  INSERT INTO public.cahet_registrations (lead_id, registration_no, document_url, notes, registered_by)
  VALUES (p_lead_id, trim(p_registration_no), p_document_url, p_notes, v_profile_id)
  RETURNING * INTO v_row;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (p_lead_id, v_profile_id, 'system',
          'CAHET registration recorded (no: ' || trim(p_registration_no) || ')');

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_mark_registered(uuid, text, text, text) TO authenticated;

-- ========== UPDELED storage ==========

DROP POLICY IF EXISTS "Staff can upload updeled docs" ON storage.objects;
CREATE POLICY "Staff can upload updeled docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'updeled-registrations' AND (
      public.has_role(auth.uid(), 'super_admin') OR
      public.has_role(auth.uid(), 'campus_admin') OR
      public.has_role(auth.uid(), 'principal') OR
      public.has_role(auth.uid(), 'admission_head') OR
      public.has_role(auth.uid(), 'counsellor')
    )
  );

DROP POLICY IF EXISTS "Staff can view updeled docs" ON storage.objects;
CREATE POLICY "Staff can view updeled docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'updeled-registrations' AND (
      public.has_role(auth.uid(), 'super_admin') OR
      public.has_role(auth.uid(), 'campus_admin') OR
      public.has_role(auth.uid(), 'principal') OR
      public.has_role(auth.uid(), 'admission_head') OR
      public.has_role(auth.uid(), 'counsellor')
    )
  );

-- ========== UPDELED table ==========

DROP POLICY IF EXISTS "Staff can view updeled registrations" ON public.updeled_registrations;
CREATE POLICY "Staff can view updeled registrations"
  ON public.updeled_registrations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Staff can insert updeled registrations" ON public.updeled_registrations;
CREATE POLICY "Staff can insert updeled registrations"
  ON public.updeled_registrations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Staff can update updeled registrations" ON public.updeled_registrations;
CREATE POLICY "Staff can update updeled registrations"
  ON public.updeled_registrations FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

CREATE OR REPLACE FUNCTION public.updeled_mark_registered(
  p_lead_id uuid,
  p_registration_no text,
  p_document_url text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.updeled_registrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.updeled_registrations;
  v_profile_id uuid;
BEGIN
  IF p_lead_id IS NULL OR p_registration_no IS NULL OR length(trim(p_registration_no)) = 0 THEN
    RAISE EXCEPTION 'lead_id and registration_no are required';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  ) THEN
    RAISE EXCEPTION 'not authorized to mark updeled registrations';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.updeled_deled_leads dl WHERE dl.lead_id = p_lead_id) THEN
    RAISE EXCEPTION 'UPDELED registration is only applicable to D.El.Ed leads';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid();

  INSERT INTO public.updeled_registrations (lead_id, registration_no, document_url, notes, registered_by)
  VALUES (p_lead_id, trim(p_registration_no), p_document_url, p_notes, v_profile_id)
  ON CONFLICT (lead_id) DO UPDATE SET
    registration_no = EXCLUDED.registration_no,
    document_url = COALESCE(EXCLUDED.document_url, public.updeled_registrations.document_url),
    notes = EXCLUDED.notes,
    registered_by = EXCLUDED.registered_by,
    registered_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (p_lead_id, v_profile_id, 'system',
          'UPDELED registration recorded (no: ' || trim(p_registration_no) || ')');

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.updeled_mark_registered(uuid, text, text, text) TO authenticated;
