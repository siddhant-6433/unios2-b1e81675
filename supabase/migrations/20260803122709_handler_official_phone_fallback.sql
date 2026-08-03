-- Handler "official" phone fallback.
--
-- Both assignment paths recorded assigned_handler_official_phone from ONLY
-- employee_profiles.work_number, which is empty for virtually every staff
-- member — so Student Services showed "Official No: Missing" and WhatsApp had
-- no number, even though the user has a mobile/OTP phone on record
-- (profiles.phone). Fall back work_number -> mobile_number -> profiles.phone
-- in both the manual RPC and the auto-assign rule engine, and backfill the
-- already-assigned requests.

CREATE OR REPLACE FUNCTION public.assign_student_service_handler(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.alumni_verification_requests%ROWTYPE;
  v_rule public.student_service_handler_rules%ROWTYPE;
  v_profile record;
BEGIN
  SELECT * INTO v_req
  FROM public.alumni_verification_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT r.* INTO v_rule
  FROM public.student_service_handler_rules r
  WHERE r.is_active
    AND r.service_type = COALESCE(v_req.request_type, 'verification')
    AND (
      (v_req.course_id IS NOT NULL AND r.course_id = v_req.course_id)
      OR (
        r.course_id IS NULL
        AND r.course_text_normalized IS NOT NULL
        AND r.course_text_normalized = public.normalize_student_service_course(v_req.course)
      )
      OR (r.course_id IS NULL AND r.course_text_normalized IS NULL)
    )
    AND (r.batch_year IS NULL OR r.batch_year = v_req.year_of_passing)
  ORDER BY
    CASE
      WHEN v_req.course_id IS NOT NULL AND r.course_id = v_req.course_id AND r.batch_year = v_req.year_of_passing THEN 1
      WHEN v_req.course_id IS NOT NULL AND r.course_id = v_req.course_id AND r.batch_year IS NULL THEN 2
      WHEN r.course_id IS NULL AND r.course_text_normalized = public.normalize_student_service_course(v_req.course) AND r.batch_year = v_req.year_of_passing THEN 3
      WHEN r.course_id IS NULL AND r.course_text_normalized = public.normalize_student_service_course(v_req.course) AND r.batch_year IS NULL THEN 4
      WHEN r.course_id IS NULL AND r.course_text_normalized IS NULL AND r.batch_year IS NULL THEN 5
      ELSE 99
    END,
    r.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.alumni_verification_requests
    SET assignment_status = 'unassigned',
        assigned_handler_user_id = NULL,
        assigned_handler_profile_id = NULL,
        assigned_handler_name = NULL,
        assigned_handler_email = NULL,
        assigned_handler_official_phone = NULL,
        assignment_rule_id = NULL
    WHERE id = _request_id;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT ur.user_id,
           'student_service_unassigned',
           'Student Services request needs assignment',
           COALESCE(v_req.request_number, 'Request') || ' has no handler rule for ' ||
             COALESCE(v_req.course, 'unknown course') || ' batch ' || COALESCE(v_req.year_of_passing::text, '-'),
           '/alumni-verifications'
    FROM public.user_roles ur
    WHERE ur.role = 'super_admin'::public.app_role;

    PERFORM public.notify_student_service_assignment(_request_id, 'unassigned');
    RETURN NULL;
  END IF;

  SELECT
    p.id AS profile_id,
    COALESCE(ep.display_name, p.display_name) AS display_name,
    COALESCE(NULLIF(ep.work_email, ''), NULLIF(p.email, '')) AS work_email,
    COALESCE(NULLIF(ep.work_number, ''), NULLIF(ep.mobile_number, ''), NULLIF(p.phone, '')) AS official_phone
  INTO v_profile
  FROM public.profiles p
  LEFT JOIN public.employee_profiles ep ON ep.user_id = p.user_id
  WHERE p.user_id = v_rule.handler_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.alumni_verification_requests
    SET assignment_status = 'unassigned',
        assigned_handler_user_id = NULL,
        assigned_handler_profile_id = NULL,
        assigned_handler_name = NULL,
        assigned_handler_email = NULL,
        assigned_handler_official_phone = NULL,
        assignment_rule_id = NULL
    WHERE id = _request_id;

    PERFORM public.notify_student_service_assignment(_request_id, 'unassigned');
    RETURN NULL;
  END IF;

  UPDATE public.alumni_verification_requests
  SET assigned_handler_user_id = v_rule.handler_user_id,
      assigned_handler_profile_id = v_profile.profile_id,
      assigned_handler_name = v_profile.display_name,
      assigned_handler_email = v_profile.work_email,
      assigned_handler_official_phone = v_profile.official_phone,
      assigned_at = now(),
      assignment_rule_id = v_rule.id,
      assignment_status = 'assigned'
  WHERE id = _request_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    v_rule.handler_user_id,
    'student_service_assigned',
    'Student Services request assigned',
    COALESCE(v_req.request_number, 'Request') || ' - ' || COALESCE(v_req.alumni_name, 'Student') ||
      ' | ' || COALESCE(v_req.course, 'Course') || ' batch ' || COALESCE(v_req.year_of_passing::text, '-') ||
      CASE WHEN v_req.due_date IS NOT NULL THEN ' | Due ' || v_req.due_date::text ELSE '' END,
    '/alumni-verifications'
  );

  PERFORM public.notify_student_service_assignment(_request_id, 'assigned');
  RETURN v_rule.handler_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_student_service_request(
  _request_id uuid,
  _handler_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to assign Student Services requests';
  END IF;

  SELECT
    p.id AS profile_id,
    COALESCE(ep.display_name, p.display_name) AS display_name,
    COALESCE(NULLIF(ep.work_email, ''), NULLIF(p.email, '')) AS work_email,
    COALESCE(NULLIF(ep.work_number, ''), NULLIF(ep.mobile_number, ''), NULLIF(p.phone, '')) AS official_phone
  INTO v_profile
  FROM public.profiles p
  LEFT JOIN public.employee_profiles ep ON ep.user_id = p.user_id
  WHERE p.user_id = _handler_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Handler profile not found';
  END IF;

  UPDATE public.alumni_verification_requests
  SET assigned_handler_user_id = _handler_user_id,
      assigned_handler_profile_id = v_profile.profile_id,
      assigned_handler_name = v_profile.display_name,
      assigned_handler_email = v_profile.work_email,
      assigned_handler_official_phone = v_profile.official_phone,
      assigned_at = now(),
      assignment_rule_id = NULL,
      assignment_status = 'manual'
  WHERE id = _request_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT
    _handler_user_id,
    'student_service_assigned',
    'Student Services request assigned',
    COALESCE(avr.request_number, 'Request') || ' - ' || COALESCE(avr.alumni_name, 'Student') ||
      ' | ' || COALESCE(avr.course, 'Course') || ' batch ' || COALESCE(avr.year_of_passing::text, '-') ||
      CASE WHEN avr.due_date IS NOT NULL THEN ' | Due ' || avr.due_date::text ELSE '' END,
    '/alumni-verifications'
  FROM public.alumni_verification_requests avr
  WHERE avr.id = _request_id;

  PERFORM public.notify_student_service_assignment(_request_id, 'manual');
  RETURN _handler_user_id;
END;
$$;

-- Backfill already-assigned requests whose official phone is blank.
UPDATE public.alumni_verification_requests avr
SET assigned_handler_official_phone = COALESCE(NULLIF(ep.work_number, ''), NULLIF(ep.mobile_number, ''), NULLIF(p.phone, ''))
FROM public.profiles p
LEFT JOIN public.employee_profiles ep ON ep.user_id = p.user_id
WHERE avr.assigned_handler_user_id = p.user_id
  AND COALESCE(NULLIF(avr.assigned_handler_official_phone, ''), '') = ''
  AND COALESCE(NULLIF(ep.work_number, ''), NULLIF(ep.mobile_number, ''), NULLIF(p.phone, '')) IS NOT NULL;
