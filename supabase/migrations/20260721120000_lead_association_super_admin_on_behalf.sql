-- Let a super_admin submit a lead association request on behalf of a consultant
-- or academic partner. The portals run under UI-only impersonation ("Viewing as
-- X"), which never swaps the JWT — so auth.uid() is the super_admin and the
-- identity checks below raise "Invalid consultant" / "Invalid academic partner".
-- Relax those checks (and the partner course-scope check) for super_admins; real
-- consultants/partners are unaffected.
CREATE OR REPLACE FUNCTION public.submit_lead_association_request(
  _requester_type text,
  _name text,
  _phone text,
  _email text DEFAULT NULL::text,
  _course_id uuid DEFAULT NULL::uuid,
  _campus_id uuid DEFAULT NULL::uuid,
  _notes text DEFAULT NULL::text,
  _consultant_id uuid DEFAULT NULL::uuid,
  _academic_partner_id uuid DEFAULT NULL::uuid,
  _share_with_nimt boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_super boolean := public.has_role(auth.uid(), 'super_admin'::app_role);
  v_phone text;
  v_existing_lead_id uuid;
  v_request_id uuid;
  v_new_lead_id uuid;
  v_shared boolean := CASE WHEN _requester_type = 'academic_partner'
                           THEN COALESCE(_share_with_nimt, false) ELSE true END;
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
      WHERE c.id = _consultant_id AND (c.user_id = v_uid OR v_is_super)
    ) THEN
      RAISE EXCEPTION 'Invalid consultant';
    END IF;
  ELSIF _requester_type = 'academic_partner' THEN
    IF _academic_partner_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.academic_partners ap
      WHERE ap.id = _academic_partner_id AND (ap.user_id = v_uid OR v_is_super) AND ap.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Invalid academic partner';
    END IF;
    IF _course_id IS NULL OR NOT (public.is_academic_partner_scope(v_uid, _course_id, NULL) OR v_is_super) THEN
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
      consultant_id, academic_partner_id, notes, stage,
      shared_with_nimt, skip_ai_call
    )
    VALUES (
      _name, v_phone, NULLIF(_email, ''),
      CASE WHEN _requester_type = 'consultant' THEN 'consultant'::lead_source ELSE 'academic_partner'::lead_source END,
      _course_id, _campus_id,
      CASE WHEN _requester_type = 'consultant' THEN _consultant_id ELSE NULL END,
      CASE WHEN _requester_type = 'academic_partner' THEN _academic_partner_id ELSE NULL END,
      NULLIF(_notes, ''),
      'new_lead'::lead_stage,
      v_shared,
      (_requester_type = 'academic_partner' AND NOT v_shared)
    )
    RETURNING id INTO v_new_lead_id;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (
      v_new_lead_id,
      'system',
      CASE WHEN _requester_type = 'consultant'
        THEN 'Lead added via consultant portal'
        WHEN _requester_type = 'academic_partner' AND NOT v_shared
        THEN 'Lead added via academic partner portal (private — not shared with NIMT)'
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
$function$;
