-- Student Services fixes:
--   1. student_service_assignable_handlers() — the handler-assignment dropdown
--      sourced its list from admin_user_directory, which is gated on
--      super_admin OR user_management:view. Student Services managers
--      (office_admin / office_assistant / school_coordinator) have
--      alumni_verification:manage but NOT user_management:view, so the dropdown
--      came back empty for them. This RPC returns the assignable staff list
--      gated on the SAME permission as the Student Services page.
--   2. mark_alumni_request_paid_offline() — record an offline / reconciled
--      payment on a pending-payment request (e.g. Easebuzz payments that were
--      initiated but whose confirmation callback never arrived).

CREATE OR REPLACE FUNCTION public.student_service_assignable_handlers()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  work_email text,
  work_number text,
  personal_mobile text,
  role public.app_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.user_id, s.display_name, s.work_email, s.work_number, s.personal_mobile, s.role
  FROM (
    SELECT DISTINCT ON (p.user_id)
      p.user_id,
      COALESCE(NULLIF(ep.display_name, ''), NULLIF(p.display_name, ''), p.email, p.user_id::text) AS display_name,
      COALESCE(NULLIF(ep.work_email, ''), p.email, '') AS work_email,
      COALESCE(ep.work_number, '') AS work_number,
      COALESCE(ep.mobile_number, p.phone, '') AS personal_mobile,
      ur.role
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    LEFT JOIN public.employee_profiles ep ON ep.user_id = p.user_id
    WHERE (
        public.has_role(auth.uid(), 'super_admin'::public.app_role)
        OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
      )
      AND p.deleted_at IS NULL
      AND p.archived_at IS NULL
      AND ur.role::text NOT IN (
        'student', 'parent', 'consultant', 'academic_partner',
        'academic_partner_offer_letter', 'publisher'
      )
    ORDER BY p.user_id, ur.role
  ) s
  ORDER BY s.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.student_service_assignable_handlers() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_alumni_request_paid_offline(
  _request_id uuid,
  _method text DEFAULT 'offline',
  _reference text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.alumni_verification_requests%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR 'alumni_verification:manage' = ANY(public.get_user_permissions(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Not authorized to record payments';
  END IF;

  SELECT * INTO v_req
  FROM public.alumni_verification_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_req.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'Request is not pending payment (current status: %)', v_req.status;
  END IF;

  UPDATE public.alumni_verification_requests
  SET status = 'paid',
      paid_at = now(),
      payment_method = COALESCE(NULLIF(_method, ''), 'offline'),
      payment_ref = COALESCE(NULLIF(_reference, ''), payment_ref)
  WHERE id = _request_id;

  RETURN 'paid';
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_alumni_request_paid_offline(uuid, text, text) TO authenticated;
