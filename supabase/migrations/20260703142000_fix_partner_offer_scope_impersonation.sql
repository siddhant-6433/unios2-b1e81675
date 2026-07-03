-- Fix academic partner offer-letter scoping under super-admin impersonation.
--
-- The browser can impersonate a partner role while the database still sees the
-- real auth.uid() as a super-admin. These RPCs accept an explicit partner id
-- only for super-admin callers so local QA can exercise the same scoped data
-- without broad RLS leaking rows into the partner portal.

CREATE OR REPLACE FUNCTION public.academic_partner_paid_applications(_partner_id uuid DEFAULT NULL)
RETURNS TABLE (
  lead_id uuid,
  name text,
  phone text,
  email text,
  stage text,
  source text,
  academic_partner_id uuid,
  counsellor_id uuid,
  application_uuid uuid,
  application_id text,
  application_status text,
  application_payment_status text,
  application_submitted_at timestamptz,
  application_created_at timestamptz,
  application_fee_amount numeric,
  application_completed_sections jsonb,
  application_form_pdf_url text,
  course_id uuid,
  course_name text,
  campus_id uuid,
  campus_name text,
  attribution_type text,
  attribution_label text,
  has_offer boolean,
  latest_offer_id uuid,
  latest_offer_letter_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _partner_id IS NOT NULL THEN
    IF NOT public.has_role(v_uid, 'super_admin'::public.app_role) THEN
      RAISE EXCEPTION 'Only super-admin users can scope paid applications by partner id';
    END IF;
    v_partner_id := _partner_id;
  ELSE
    IF NOT public.has_role(v_uid, 'academic_partner_offer_letter'::public.app_role) THEN
      RAISE EXCEPTION 'Only academic partner offer-letter users can view assigned paid applications';
    END IF;

    SELECT ap.id
      INTO v_partner_id
    FROM public.academic_partners ap
    WHERE ap.user_id = v_uid
      AND ap.status = 'active'
    LIMIT 1;
  END IF;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Academic partner profile not found';
  END IF;

  RETURN QUERY
  SELECT
    l.id AS lead_id,
    l.name,
    l.phone,
    l.email,
    l.stage::text,
    l.source::text,
    l.academic_partner_id,
    l.counsellor_id,
    a.id AS application_uuid,
    a.application_id,
    a.status AS application_status,
    a.payment_status AS application_payment_status,
    a.submitted_at AS application_submitted_at,
    a.created_at AS application_created_at,
    a.fee_amount AS application_fee_amount,
    a.completed_sections AS application_completed_sections,
    a.form_pdf_url AS application_form_pdf_url,
    scope_match.course_id,
    scope_match.course_name,
    l.campus_id,
    COALESCE(cmp.name, '-') AS campus_name,
    CASE
      WHEN l.academic_partner_id = v_partner_id THEN 'attributed_to_you'
      WHEN l.academic_partner_id IS NOT NULL THEN 'not_attributed_to_you'
      WHEN l.counsellor_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.lead_counsellors lc WHERE lc.lead_id = l.id) THEN 'nimt_counsellor'
      ELSE 'direct'
    END AS attribution_type,
    CASE
      WHEN l.academic_partner_id = v_partner_id THEN 'Attributed to you'
      WHEN l.academic_partner_id IS NOT NULL THEN 'Not attributed to you'
      WHEN l.counsellor_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.lead_counsellors lc WHERE lc.lead_id = l.id) THEN 'NIMT counsellor'
      ELSE 'Direct'
    END AS attribution_label,
    latest_offer.id IS NOT NULL AS has_offer,
    latest_offer.id AS latest_offer_id,
    latest_offer.letter_url AS latest_offer_letter_url
  FROM public.applications a
  JOIN public.leads l ON l.id = a.lead_id
  JOIN LATERAL (
    SELECT apa.course_id, c.name AS course_name
    FROM public.academic_partner_assignments apa
    JOIN public.courses c ON c.id = apa.course_id
    LEFT JOIN public.batches b ON b.id = apa.batch_id
    WHERE apa.partner_id = v_partner_id
      AND apa.is_active = true
      AND (
        l.course_id = apa.course_id
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(a.course_selections, '[]'::jsonb)) selection
          WHERE selection->>'course_id' = apa.course_id::text
        )
      )
      AND (
        apa.batch_id IS NULL
        OR a.session_id IS NULL
        OR b.session_id = a.session_id
      )
    ORDER BY CASE WHEN l.course_id = apa.course_id THEN 0 ELSE 1 END
    LIMIT 1
  ) scope_match ON true
  LEFT JOIN public.campuses cmp ON cmp.id = l.campus_id
  LEFT JOIN LATERAL (
    SELECT ol.id, ol.letter_url
    FROM public.offer_letters ol
    WHERE ol.lead_id = l.id
    ORDER BY ol.created_at DESC
    LIMIT 1
  ) latest_offer ON true
  WHERE a.payment_status = 'paid'
  ORDER BY a.created_at DESC
  LIMIT 500;
END;
$$;

CREATE OR REPLACE FUNCTION public.academic_partner_issue_offer(
  _application_id text,
  _acceptance_deadline date,
  _session_id uuid,
  _total_fee numeric,
  _net_fee numeric,
  _token_fee_amount numeric,
  _token_fee_user_edited boolean DEFAULT false,
  _admission_mode text DEFAULT 'direct',
  _entrance_exam_name text DEFAULT NULL,
  _partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
  v_profile_id uuid;
  v_app public.applications;
  v_lead public.leads;
  v_old_stage public.lead_stage;
  v_offer_id uuid;
  v_offer_course_id uuid;
  v_offer_campus_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _partner_id IS NOT NULL THEN
    IF NOT public.has_role(v_uid, 'super_admin'::public.app_role) THEN
      RAISE EXCEPTION 'Only super-admin users can issue partner offers by partner id';
    END IF;
    v_partner_id := _partner_id;
  ELSE
    IF NOT public.has_role(v_uid, 'academic_partner_offer_letter'::public.app_role) THEN
      RAISE EXCEPTION 'Only academic partner offer-letter users can issue offers';
    END IF;

    SELECT ap.id
      INTO v_partner_id
    FROM public.academic_partners ap
    WHERE ap.user_id = v_uid
      AND ap.status = 'active'
    LIMIT 1;
  END IF;

  IF _application_id IS NULL OR trim(_application_id) = '' THEN
    RAISE EXCEPTION 'application_id is required';
  END IF;
  IF _acceptance_deadline IS NULL THEN
    RAISE EXCEPTION 'Acceptance deadline is required';
  END IF;
  IF _session_id IS NULL THEN
    RAISE EXCEPTION 'Academic session is required';
  END IF;
  IF COALESCE(_total_fee, 0) <= 0 OR COALESCE(_net_fee, 0) <= 0 THEN
    RAISE EXCEPTION 'Offer fee must be greater than zero';
  END IF;
  IF COALESCE(_token_fee_amount, 0) < 5000 THEN
    RAISE EXCEPTION 'Token fee must be at least 5000';
  END IF;
  IF COALESCE(_admission_mode, 'direct') NOT IN ('direct', 'entrance') THEN
    RAISE EXCEPTION 'Invalid admission mode';
  END IF;
  IF COALESCE(_admission_mode, 'direct') = 'entrance' AND NULLIF(trim(COALESCE(_entrance_exam_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Entrance or counselling name is required';
  END IF;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Academic partner profile not found';
  END IF;

  SELECT *
    INTO v_app
  FROM public.applications
  WHERE application_id = _application_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF v_app.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Application fee is not paid';
  END IF;
  IF v_app.lead_id IS NULL THEN
    RAISE EXCEPTION 'Application is not linked to a lead';
  END IF;

  SELECT *
    INTO v_lead
  FROM public.leads
  WHERE id = v_app.lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application lead not found';
  END IF;

  SELECT apa.course_id
    INTO v_offer_course_id
  FROM public.academic_partner_assignments apa
  LEFT JOIN public.batches b ON b.id = apa.batch_id
  WHERE apa.partner_id = v_partner_id
    AND apa.is_active = true
    AND (
      v_lead.course_id = apa.course_id
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(v_app.course_selections, '[]'::jsonb)) selection
        WHERE selection->>'course_id' = apa.course_id::text
      )
    )
    AND (
      apa.batch_id IS NULL
      OR v_app.session_id IS NULL
      OR b.session_id = v_app.session_id
    )
  ORDER BY CASE WHEN v_lead.course_id = apa.course_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_offer_course_id IS NULL THEN
    RAISE EXCEPTION 'Application is outside academic partner assigned course scope';
  END IF;

  v_offer_campus_id := v_lead.campus_id;
  IF v_offer_campus_id IS NULL THEN
    SELECT NULLIF(selection->>'campus_id', '')::uuid
      INTO v_offer_campus_id
    FROM jsonb_array_elements(COALESCE(v_app.course_selections, '[]'::jsonb)) selection
    WHERE selection->>'course_id' = v_offer_course_id::text
      AND COALESCE(selection->>'campus_id', '') ~* '^[0-9a-f-]{36}$'
    LIMIT 1;
  END IF;

  SELECT id INTO v_profile_id
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  INSERT INTO public.offer_letters (
    lead_id,
    total_fee,
    scholarship_amount,
    net_fee,
    token_fee_amount,
    token_fee_user_edited,
    admission_mode,
    entrance_exam_name,
    acceptance_deadline,
    course_id,
    campus_id,
    session_id,
    issued_by,
    approval_status,
    approved_by,
    approved_at
  )
  VALUES (
    v_lead.id,
    _total_fee,
    0,
    _net_fee,
    _token_fee_amount,
    COALESCE(_token_fee_user_edited, false),
    COALESCE(_admission_mode, 'direct'),
    CASE WHEN COALESCE(_admission_mode, 'direct') = 'entrance' THEN NULLIF(trim(_entrance_exam_name), '') ELSE NULL END,
    _acceptance_deadline,
    v_offer_course_id,
    v_offer_campus_id,
    _session_id,
    v_uid,
    'approved',
    v_uid,
    now()
  )
  RETURNING id INTO v_offer_id;

  v_old_stage := v_lead.stage;
  IF v_lead.stage::text NOT IN ('token_paid', 'pre_admitted', 'admitted', 'rejected', 'ineligible', 'dnc') THEN
    UPDATE public.leads
      SET stage = 'offer_sent'::public.lead_stage,
          offer_amount = _net_fee,
          updated_at = now()
    WHERE id = v_lead.id;
  END IF;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description, old_stage, new_stage)
  VALUES (
    v_lead.id,
    v_profile_id,
    'offer',
    'Offer letter issued by academic partner: ' || _net_fee::text,
    v_old_stage,
    CASE WHEN v_old_stage::text NOT IN ('token_paid', 'pre_admitted', 'admitted', 'rejected', 'ineligible', 'dnc')
      THEN 'offer_sent'::public.lead_stage
      ELSE v_old_stage
    END
  );

  INSERT INTO public.application_on_behalf_audit (
    action,
    lead_id,
    application_uuid,
    application_id,
    offer_letter_id,
    actor_user_id,
    academic_partner_id,
    candidate_phone,
    metadata
  )
  VALUES (
    'offer_issued_by_partner',
    v_lead.id,
    v_app.id,
    v_app.application_id,
    v_offer_id,
    v_uid,
    v_partner_id,
    v_lead.phone,
    jsonb_build_object(
      'total_fee', _total_fee,
      'net_fee', _net_fee,
      'token_fee_amount', _token_fee_amount,
      'admission_mode', COALESCE(_admission_mode, 'direct'),
      'partner_id_override', _partner_id
    )
  );

  RETURN jsonb_build_object(
    'offer_letter_id', v_offer_id,
    'lead_id', v_lead.id,
    'application_id', v_app.application_id,
    'approval_status', 'approved'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.academic_partner_paid_applications(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academic_partner_issue_offer(text, date, uuid, numeric, numeric, numeric, boolean, text, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
