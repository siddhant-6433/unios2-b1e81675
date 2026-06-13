-- Duplicate lead association approval for consultants and academic partners.
-- New CRM leads can be associated immediately. Existing CRM leads require
-- super-admin approval before ownership is attached.

CREATE TABLE IF NOT EXISTS public.lead_association_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_type text NOT NULL CHECK (requester_type IN ('consultant', 'academic_partner')),
  consultant_id uuid REFERENCES public.consultants(id) ON DELETE CASCADE,
  academic_partner_id uuid REFERENCES public.academic_partners(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  requested_phone text NOT NULL,
  proposed_name text NOT NULL,
  proposed_email text,
  proposed_course_id uuid REFERENCES public.courses(id),
  proposed_campus_id uuid REFERENCES public.campuses(id),
  proposed_notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by uuid REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (requester_type = 'consultant' AND consultant_id IS NOT NULL AND academic_partner_id IS NULL)
    OR
    (requester_type = 'academic_partner' AND academic_partner_id IS NOT NULL AND consultant_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_lar_status ON public.lead_association_requests(status);
CREATE INDEX IF NOT EXISTS idx_lar_lead ON public.lead_association_requests(lead_id);
CREATE INDEX IF NOT EXISTS idx_lar_consultant ON public.lead_association_requests(consultant_id);
CREATE INDEX IF NOT EXISTS idx_lar_academic_partner ON public.lead_association_requests(academic_partner_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lar_pending_consultant_lead
  ON public.lead_association_requests(consultant_id, lead_id)
  WHERE requester_type = 'consultant' AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_lar_pending_academic_partner_lead
  ON public.lead_association_requests(academic_partner_id, lead_id)
  WHERE requester_type = 'academic_partner' AND status = 'pending';

ALTER TABLE public.lead_association_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage lead association requests" ON public.lead_association_requests;
CREATE POLICY "Super admins manage lead association requests"
  ON public.lead_association_requests FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'super_admin'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Consultants view own lead association requests" ON public.lead_association_requests;
CREATE POLICY "Consultants view own lead association requests"
  ON public.lead_association_requests FOR SELECT TO authenticated
  USING (
    requester_type = 'consultant'
    AND consultant_id IN (
      SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Academic partners view own lead association requests" ON public.lead_association_requests;
CREATE POLICY "Academic partners view own lead association requests"
  ON public.lead_association_requests FOR SELECT TO authenticated
  USING (
    requester_type = 'academic_partner'
    AND academic_partner_id IN (
      SELECT id FROM public.academic_partners WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.normalize_lead_phone(_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  v_phone := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF length(v_phone) = 10 THEN
    RETURN '+91' || v_phone;
  ELSIF length(v_phone) = 12 AND v_phone LIKE '91%' THEN
    RETURN '+' || v_phone;
  ELSIF length(v_phone) > 0 THEN
    RETURN '+' || v_phone;
  END IF;
  RETURN '';
END;
$$;

CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone
  ON public.leads (public.normalize_lead_phone(phone));

CREATE OR REPLACE FUNCTION public.submit_lead_association_request(
  _requester_type text,
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _consultant_id uuid DEFAULT NULL,
  _academic_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_existing_lead_id uuid;
  v_request_id uuid;
  v_new_lead_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_phone := public.normalize_lead_phone(_phone);
  IF v_phone = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;

  IF _requester_type = 'consultant' THEN
    IF _consultant_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.consultants c
      WHERE c.id = _consultant_id AND c.user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Invalid consultant';
    END IF;
  ELSIF _requester_type = 'academic_partner' THEN
    IF _academic_partner_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.academic_partners ap
      WHERE ap.id = _academic_partner_id AND ap.user_id = v_uid AND ap.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Invalid academic partner';
    END IF;
    IF _course_id IS NULL OR NOT public.is_academic_partner_scope(v_uid, _course_id, NULL) THEN
      RAISE EXCEPTION 'Course is outside academic partner scope';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid requester type';
  END IF;

  SELECT id INTO v_existing_lead_id
  FROM public.leads
  WHERE public.normalize_lead_phone(phone) = v_phone
  LIMIT 1;

  IF v_existing_lead_id IS NULL THEN
    INSERT INTO public.leads (
      name, phone, email, source, course_id, campus_id,
      consultant_id, academic_partner_id, notes, stage
    )
    VALUES (
      _name, v_phone, NULLIF(_email, ''),
      CASE WHEN _requester_type = 'consultant' THEN 'consultant'::lead_source ELSE 'academic_partner'::lead_source END,
      _course_id, _campus_id,
      CASE WHEN _requester_type = 'consultant' THEN _consultant_id ELSE NULL END,
      CASE WHEN _requester_type = 'academic_partner' THEN _academic_partner_id ELSE NULL END,
      NULLIF(_notes, ''),
      'new_lead'::lead_stage
    )
    RETURNING id INTO v_new_lead_id;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (
      v_new_lead_id,
      'system',
      CASE WHEN _requester_type = 'consultant'
        THEN 'Lead added via consultant portal'
        ELSE 'Lead added via academic partner portal'
      END
    );

    RETURN jsonb_build_object('status', 'created', 'lead_id', v_new_lead_id);
  END IF;

  SELECT id INTO v_request_id
  FROM public.lead_association_requests
  WHERE requester_type = _requester_type
    AND status = 'pending'
    AND lead_id = v_existing_lead_id
    AND (
      (_requester_type = 'consultant' AND consultant_id = _consultant_id)
      OR
      (_requester_type = 'academic_partner' AND academic_partner_id = _academic_partner_id)
    )
  LIMIT 1;

  IF v_request_id IS NULL THEN
    INSERT INTO public.lead_association_requests (
      requester_type, consultant_id, academic_partner_id, lead_id,
      requested_phone, proposed_name, proposed_email, proposed_course_id,
      proposed_campus_id, proposed_notes, requested_by
    )
    VALUES (
      _requester_type,
      CASE WHEN _requester_type = 'consultant' THEN _consultant_id ELSE NULL END,
      CASE WHEN _requester_type = 'academic_partner' THEN _academic_partner_id ELSE NULL END,
      v_existing_lead_id,
      v_phone,
      _name,
      NULLIF(_email, ''),
      _course_id,
      _campus_id,
      NULLIF(_notes, ''),
      v_uid
    )
    RETURNING id INTO v_request_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'pending',
    'request_id', v_request_id,
    'lead_id', v_existing_lead_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_lead_association_request(
  _request_id uuid,
  _approved boolean,
  _review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_req public.lead_association_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can review lead association requests';
  END IF;

  SELECT * INTO v_req
  FROM public.lead_association_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_req.status, 'lead_id', v_req.lead_id);
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF _approved THEN
    IF v_req.requester_type = 'consultant' THEN
      UPDATE public.leads
      SET consultant_id = v_req.consultant_id,
          updated_at = now()
      WHERE id = v_req.lead_id;
    ELSE
      UPDATE public.leads
      SET academic_partner_id = v_req.academic_partner_id,
          updated_at = now()
      WHERE id = v_req.lead_id;
    END IF;

    INSERT INTO public.lead_activities (lead_id, type, description, user_id)
    VALUES (
      v_req.lead_id,
      'system',
      CASE WHEN v_req.requester_type = 'consultant'
        THEN 'Consultant lead association approved'
        ELSE 'Academic partner lead association approved'
      END,
      v_profile_id
    );
  END IF;

  UPDATE public.lead_association_requests
  SET status = CASE WHEN _approved THEN 'approved' ELSE 'rejected' END,
      reviewed_by = v_profile_id,
      reviewed_at = now(),
      review_notes = NULLIF(_review_notes, ''),
      updated_at = now()
  WHERE id = _request_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN _approved THEN 'approved' ELSE 'rejected' END,
    'lead_id', v_req.lead_id
  );
END;
$$;

-- Stop staff Add Lead from silently attaching duplicate CRM leads to consultants.
DROP FUNCTION IF EXISTS public.insert_lead(text, text, text, text, text, text, uuid, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.insert_lead(
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _guardian_name text DEFAULT NULL,
  _guardian_phone text DEFAULT NULL,
  _source text DEFAULT 'website',
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _counsellor_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _consultant_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_phone text;
BEGIN
  v_phone := public.normalize_lead_phone(_phone);

  SELECT id INTO v_lead_id
  FROM public.leads
  WHERE public.normalize_lead_phone(phone) = v_phone
  LIMIT 1;
  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads SET
      name = COALESCE(NULLIF(_name, ''), name),
      email = COALESCE(NULLIF(_email, ''), email),
      guardian_name = COALESCE(NULLIF(_guardian_name, ''), guardian_name),
      guardian_phone = COALESCE(NULLIF(_guardian_phone, ''), guardian_phone),
      course_id = COALESCE(_course_id, course_id),
      campus_id = COALESCE(_campus_id, campus_id),
      counsellor_id = COALESCE(_counsellor_id, counsellor_id),
      updated_at = now()
    WHERE id = v_lead_id;
    RETURN v_lead_id;
  END IF;

  INSERT INTO public.leads (
    name, phone, email, guardian_name, guardian_phone,
    source, course_id, campus_id, counsellor_id, consultant_id, stage
  )
  VALUES (
    _name, v_phone, NULLIF(_email, ''),
    NULLIF(_guardian_name, ''), NULLIF(_guardian_phone, ''),
    _source::lead_source,
    _course_id, _campus_id, _counsellor_id, _consultant_id,
    'new_lead'::lead_stage
  )
  RETURNING id INTO v_lead_id;

  IF _notes IS NOT NULL AND _notes != '' THEN
    INSERT INTO public.lead_notes (lead_id, content) VALUES (v_lead_id, _notes);
  END IF;

  RETURN v_lead_id;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_association_requests TO authenticated;
GRANT ALL ON public.lead_association_requests TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_lead_phone(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_lead_association_request(text, text, text, text, uuid, uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_lead_association_request(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_lead TO authenticated;
