-- Academic partner offer-letter role.
-- This role stays inside the academic partner portal, can see paid
-- applications for assigned course/session scope, and can issue approved
-- offers through a server-side validator.

INSERT INTO public.permissions (module, action, description) VALUES
  ('academic_partner_offer_letters', 'issue', 'Issue approved offer letters from the academic partner portal')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'academic_partner_offer_letter'::public.app_role, p.id
FROM public.permissions p
WHERE (p.module, p.action) IN (
  ('academic_partner_portal', 'view'),
  ('academic_partner_offer_letters', 'issue')
)
ON CONFLICT (role, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_academic_partner_portal_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'academic_partner'::public.app_role)
      OR public.has_role(_user_id, 'academic_partner_offer_letter'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.is_academic_partner_offer_letter_scope(
  _user_id uuid,
  _course_id uuid,
  _session_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.academic_partners ap
    JOIN public.academic_partner_assignments apa
      ON apa.partner_id = ap.id
    LEFT JOIN public.batches b
      ON b.id = apa.batch_id
    WHERE ap.user_id = _user_id
      AND ap.status = 'active'
      AND apa.is_active = true
      AND apa.course_id = _course_id
      AND (
        apa.batch_id IS NULL
        OR _session_id IS NULL
        OR b.session_id = _session_id
      )
  );
$$;

DROP POLICY IF EXISTS "Academic partner offer role view own leads" ON public.leads;
CREATE POLICY "Academic partner offer role view own leads"
  ON public.leads FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Academic partner offer role view own lead activities" ON public.lead_activities;
CREATE POLICY "Academic partner offer role view own lead activities"
  ON public.lead_activities FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Academic partner offer role insert own lead activities" ON public.lead_activities;
CREATE POLICY "Academic partner offer role insert own lead activities"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Academic partner offer role view assigned students" ON public.students;
CREATE POLICY "Academic partner offer role view assigned students"
  ON public.students FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND course_id IS NOT NULL
    AND public.is_academic_partner_scope(auth.uid(), course_id, batch_id)
  );

DROP POLICY IF EXISTS "Academic partner offer role view assigned attendance" ON public.daily_attendance;
CREATE POLICY "Academic partner offer role view assigned attendance"
  ON public.daily_attendance FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = daily_attendance.student_id
        AND s.course_id IS NOT NULL
        AND public.is_academic_partner_scope(auth.uid(), s.course_id, COALESCE(daily_attendance.batch_id, s.batch_id))
    )
  );

DROP POLICY IF EXISTS "Academic partner offer role view mapped fee ledger" ON public.fee_ledger;
CREATE POLICY "Academic partner offer role view mapped fee ledger"
  ON public.fee_ledger FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND public.can_academic_partner_view_fee_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Academic partner offer role view mapped payments" ON public.payments;
CREATE POLICY "Academic partner offer role view mapped payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND public.can_academic_partner_view_fee_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Academic partner offer role view mapped ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Academic partner offer role view mapped ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.fee_ledger fl
      WHERE fl.id = fee_ledger_payments.fee_ledger_id
        AND public.can_academic_partner_view_fee_student(auth.uid(), fl.student_id)
    )
  );

DROP POLICY IF EXISTS "Academic partner offer role view mapped applications" ON public.applications;
CREATE POLICY "Academic partner offer role view mapped applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND lead_id IS NOT NULL
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Academic partner offer role view scoped offers" ON public.offer_letters;
CREATE POLICY "Academic partner offer role view scoped offers"
  ON public.offer_letters FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner_offer_letter'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.applications a
      JOIN public.leads l ON l.id = a.lead_id
      WHERE l.id = offer_letters.lead_id
        AND a.payment_status = 'paid'
        AND l.course_id IS NOT NULL
        AND public.is_academic_partner_offer_letter_scope(auth.uid(), l.course_id, a.session_id)
    )
  );

CREATE OR REPLACE FUNCTION public.academic_partner_paid_applications()
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

  IF NOT public.has_role(v_uid, 'academic_partner_offer_letter'::public.app_role) THEN
    RAISE EXCEPTION 'Only academic partner offer-letter users can view assigned paid applications';
  END IF;

  SELECT ap.id
    INTO v_partner_id
  FROM public.academic_partners ap
  WHERE ap.user_id = v_uid
    AND ap.status = 'active'
  LIMIT 1;

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
    l.course_id,
    COALESCE(c.name, '-') AS course_name,
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
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.campuses cmp ON cmp.id = l.campus_id
  LEFT JOIN LATERAL (
    SELECT ol.id, ol.letter_url
    FROM public.offer_letters ol
    WHERE ol.lead_id = l.id
    ORDER BY ol.created_at DESC
    LIMIT 1
  ) latest_offer ON true
  WHERE a.payment_status = 'paid'
    AND l.course_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.academic_partner_assignments apa
      LEFT JOIN public.batches b ON b.id = apa.batch_id
      WHERE apa.partner_id = v_partner_id
        AND apa.is_active = true
        AND apa.course_id = l.course_id
        AND (
          apa.batch_id IS NULL
          OR a.session_id IS NULL
          OR b.session_id = a.session_id
        )
    )
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
  _entrance_exam_name text DEFAULT NULL
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_role(v_uid, 'academic_partner_offer_letter'::public.app_role) THEN
    RAISE EXCEPTION 'Only academic partner offer-letter users can issue offers';
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

  SELECT ap.id
    INTO v_partner_id
  FROM public.academic_partners ap
  WHERE ap.user_id = v_uid
    AND ap.status = 'active'
  LIMIT 1;

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

  IF NOT FOUND OR v_lead.course_id IS NULL THEN
    RAISE EXCEPTION 'Application lead does not have a course';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.academic_partner_assignments apa
    LEFT JOIN public.batches b ON b.id = apa.batch_id
    WHERE apa.partner_id = v_partner_id
      AND apa.is_active = true
      AND apa.course_id = v_lead.course_id
      AND (
        apa.batch_id IS NULL
        OR v_app.session_id IS NULL
        OR b.session_id = v_app.session_id
      )
  ) THEN
    RAISE EXCEPTION 'Application is outside academic partner assigned course scope';
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
    v_lead.course_id,
    v_lead.campus_id,
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
      'admission_mode', COALESCE(_admission_mode, 'direct')
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

GRANT EXECUTE ON FUNCTION public.is_academic_partner_portal_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_academic_partner_offer_letter_scope(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.academic_partner_paid_applications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.academic_partner_issue_offer(text, date, uuid, numeric, numeric, numeric, boolean, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
