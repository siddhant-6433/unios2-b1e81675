-- Student Services handler routing for alumni-service request types.
-- Keeps the existing alumni_verification_requests table as the operational
-- request store, but routes paid Student Services work to a course/batch owner.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned',
  'sla_warning',
  'lead_reclaimed',
  'followup_due',
  'followup_overdue',
  'visit_confirmation_due',
  'visit_followup_due',
  'lead_transferred',
  'deletion_request',
  'whatsapp_message',
  'whatsapp_sla_warning',
  'whatsapp_sla_breach',
  'approval_pending',
  'approval_decided',
  'template_status_update',
  'tat_defaults_report',
  'post_visit_nudge',
  'score_penalty',
  'lead_bucket_backlog',
  'feedback_received',
  'campaign_completed',
  'student_service_assigned',
  'student_service_unassigned',
  'general',
  'visit_due',
  'missed_call',
  'callback_requested'
));

CREATE OR REPLACE FUNCTION public.normalize_student_service_course(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(lower(trim(coalesce(_value, ''))), '[^a-z0-9]+', '', 'g'), '');
$$;

CREATE TABLE IF NOT EXISTS public.student_service_handler_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL
    CHECK (service_type IN ('verification', 'marksheet', 'diploma', 'transcript')),
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  course_text text,
  course_text_normalized text GENERATED ALWAYS AS (public.normalize_student_service_course(course_text)) STORED,
  batch_year integer,
  handler_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (course_id IS NOT NULL OR course_text IS NOT NULL OR batch_year IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_service_handler_rules_active_unique
  ON public.student_service_handler_rules (
    service_type,
    COALESCE(course_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(course_text_normalized, ''),
    COALESCE(batch_year, -1)
  )
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_student_service_handler_rules_match
  ON public.student_service_handler_rules (service_type, course_id, course_text_normalized, batch_year)
  WHERE is_active;

ALTER TABLE public.student_service_handler_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Student service managers can view handler rules" ON public.student_service_handler_rules;
CREATE POLICY "Student service managers can view handler rules"
  ON public.student_service_handler_rules
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR 'alumni_verification:view' = ANY(public.get_user_permissions(auth.uid()))
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  );

DROP POLICY IF EXISTS "Student service managers can insert handler rules" ON public.student_service_handler_rules;
CREATE POLICY "Student service managers can insert handler rules"
  ON public.student_service_handler_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  );

DROP POLICY IF EXISTS "Student service managers can update handler rules" ON public.student_service_handler_rules;
CREATE POLICY "Student service managers can update handler rules"
  ON public.student_service_handler_rules
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  );

GRANT SELECT, INSERT, UPDATE ON public.student_service_handler_rules TO authenticated;
GRANT ALL ON public.student_service_handler_rules TO service_role;

DROP TRIGGER IF EXISTS trg_student_service_handler_rules_updated_at ON public.student_service_handler_rules;
CREATE TRIGGER trg_student_service_handler_rules_updated_at
  BEFORE UPDATE ON public.student_service_handler_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.alumni_verification_requests
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_handler_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_handler_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_handler_name text,
  ADD COLUMN IF NOT EXISTS assigned_handler_email text,
  ADD COLUMN IF NOT EXISTS assigned_handler_official_phone text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignment_rule_id uuid REFERENCES public.student_service_handler_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_status text NOT NULL DEFAULT 'unassigned'
    CHECK (assignment_status IN ('unassigned', 'assigned', 'manual'));

CREATE INDEX IF NOT EXISTS idx_avr_student_service_assignment
  ON public.alumni_verification_requests (assigned_handler_user_id, assignment_status, due_date)
  WHERE status IN ('paid', 'under_review');

CREATE INDEX IF NOT EXISTS idx_avr_course_batch_service
  ON public.alumni_verification_requests (request_type, course_id, year_of_passing);

CREATE OR REPLACE FUNCTION public.student_service_contact_details(_request_id uuid)
RETURNS TABLE (
  handler_name text,
  handler_email text,
  handler_official_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(avr.assigned_handler_name, 'Student Services Team') AS handler_name,
    COALESCE(NULLIF(avr.assigned_handler_email, ''), 'umesh@nimt.ac.in') AS handler_email,
    COALESCE(NULLIF(avr.assigned_handler_official_phone, ''), '+91-7428477664') AS handler_official_phone
  FROM public.alumni_verification_requests avr
  WHERE avr.id = _request_id;
$$;

GRANT EXECUTE ON FUNCTION public.student_service_contact_details(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_student_service_assignment(_request_id uuid, _event text DEFAULT 'assigned')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supa_url text;
  v_service_key text;
BEGIN
  SELECT value INTO v_supa_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_supa_url || '/functions/v1/student-services-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'request_id', _request_id,
      'event', _event
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_student_service_assignment(%, %) failed: %', _request_id, _event, SQLERRM;
END;
$$;

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
    NULLIF(ep.work_number, '') AS official_phone
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

REVOKE ALL ON FUNCTION public.assign_student_service_handler(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_student_service_handler(uuid) TO service_role;

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
    NULLIF(ep.work_number, '') AS official_phone
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

GRANT EXECUTE ON FUNCTION public.admin_assign_student_service_request(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_assign_student_service_handler()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('paid', 'under_review')
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.course_id IS DISTINCT FROM NEW.course_id
       OR OLD.course IS DISTINCT FROM NEW.course
       OR OLD.year_of_passing IS DISTINCT FROM NEW.year_of_passing
       OR OLD.request_type IS DISTINCT FROM NEW.request_type
     ) THEN
    PERFORM public.assign_student_service_handler(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_student_service_handler ON public.alumni_verification_requests;
CREATE TRIGGER trg_assign_student_service_handler
  AFTER INSERT OR UPDATE OF status, course_id, course, year_of_passing, request_type
  ON public.alumni_verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_assign_student_service_handler();

DROP VIEW IF EXISTS public.alumni_pending_summary;
CREATE VIEW public.alumni_pending_summary AS
SELECT
  avr.id,
  avr.request_number,
  avr.request_type,
  avr.status,
  avr.alumni_name,
  avr.course,
  avr.course_id,
  avr.year_of_passing,
  avr.employer_name,
  avr.contact_email,
  avr.fee_amount,
  avr.paid_at,
  avr.due_date,
  avr.employee_review_result,
  avr.assigned_handler_user_id,
  avr.assigned_handler_name,
  avr.assigned_handler_email,
  avr.assigned_handler_official_phone,
  avr.assignment_status,
  avr.created_at,
  CASE
    WHEN avr.due_date IS NOT NULL AND avr.due_date < CURRENT_DATE THEN true
    ELSE false
  END AS is_overdue,
  CASE
    WHEN avr.due_date IS NOT NULL THEN avr.due_date - CURRENT_DATE
    ELSE NULL
  END AS days_remaining
FROM public.alumni_verification_requests avr
WHERE avr.status IN ('paid', 'under_review')
ORDER BY avr.due_date ASC NULLS LAST;

ALTER VIEW public.alumni_pending_summary SET (security_invoker = on);
GRANT SELECT ON public.alumni_pending_summary TO authenticated;
