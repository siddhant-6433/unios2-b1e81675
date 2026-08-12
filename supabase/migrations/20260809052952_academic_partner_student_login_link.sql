-- Widen the login-link gate so an academic partner can issue/send a
-- student-portal login link for a student converted from THEIR OWN lead.
-- The partner portal's Students tab needs this; scope is bound to the
-- partner's own converted leads via can_academic_partner_view_fee_student().

CREATE OR REPLACE FUNCTION public.issue_student_login_link(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student  public.students%ROWTYPE;
  v_phone    text;
  v_base     text;
  v_token    text;
  v_id       uuid;
BEGIN
  IF NOT (public.can_collect_fee(auth.uid())
          OR public.has_role(auth.uid(), 'super_admin')
          OR public.can_academic_partner_view_fee_student(auth.uid(), _student_id)) THEN
    RAISE EXCEPTION 'Not authorised to issue a student login link'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_student FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  v_phone := NULLIF(COALESCE(v_student.phone, v_student.whatsapp_no), '');

  -- One live link at a time: a freshly handed-out link must be the one that
  -- works, and an old unclaimed token left valid is a standing back door.
  UPDATE public.student_magic_tokens
     SET expires_at = now()
   WHERE student_id = _student_id
     AND claimed_at IS NULL
     AND expires_at > now();

  INSERT INTO public.student_magic_tokens (student_id, lead_id, phone, email, expires_at, auto_send)
  VALUES (_student_id, v_student.lead_id, v_phone, NULLIF(v_student.email,''),
          now() + interval '7 days', false)
  RETURNING id, token INTO v_id, v_token;

  SELECT value INTO v_base FROM public._app_config WHERE key = 'student_portal_base';

  RETURN jsonb_build_object(
    'token_id', v_id,
    'token', v_token,
    'url',   COALESCE(v_base, 'https://uni.nimt.ac.in/student') || '?token=' || v_token,
    'phone', v_phone,
    'expires_at', (now() + interval '7 days')
  );
END;
$$;

-- ── Send it, when the cashier/partner says so ────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_student_login_link(_token_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok public.student_magic_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_tok FROM public.student_magic_tokens WHERE id = _token_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Login link not found';
  END IF;

  IF NOT (public.can_collect_fee(auth.uid())
          OR public.has_role(auth.uid(), 'super_admin')
          OR public.can_academic_partner_view_fee_student(auth.uid(), v_tok.student_id)) THEN
    RAISE EXCEPTION 'Not authorised to send a student login link'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_tok.claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'That link has already been used — generate a new one';
  END IF;
  IF v_tok.expires_at <= now() THEN
    RAISE EXCEPTION 'That link has expired — generate a new one';
  END IF;
  IF v_tok.phone IS NULL OR v_tok.phone = '' THEN
    RAISE EXCEPTION 'This student has no phone number on file, so the link cannot be sent';
  END IF;

  RETURN public.send_student_claim_link(_token_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_student_login_link(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_student_login_link(uuid) TO authenticated, service_role;
