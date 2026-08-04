-- Cashier-issued "direct login link" for a student.
--
-- The whole no-OTP path already exists: student_magic_tokens -> /student?token=
-- -> the student-portal-claim edge function, with fn_send_student_claim_link
-- delivering the URL over WhatsApp on insert (template student_portal_invite,
-- APPROVED in prod). The only thing missing was a way for a cashier to mint a
-- token: the table has RLS on with just a self-read policy, so no client
-- session can insert into it.
--
-- Pairs with 20260804090003, which fixes the claim function. Without that fix
-- this RPC would hand out links that always 500.

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
BEGIN
  IF NOT (public.can_collect_fee(auth.uid())
          OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised to issue a student login link'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_student FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  -- The trigger only sends when phone is present; surface that here rather
  -- than minting a token that silently never gets delivered.
  v_phone := NULLIF(COALESCE(v_student.phone, v_student.whatsapp_no), '');
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'This student has no phone number on file, so the link cannot be sent';
  END IF;

  -- One live link at a time: a freshly handed-out link must be the one that
  -- works, and an old unclaimed token left valid is a standing back door.
  UPDATE public.student_magic_tokens
     SET expires_at = now()
   WHERE student_id = _student_id
     AND claimed_at IS NULL
     AND expires_at > now();

  INSERT INTO public.student_magic_tokens (student_id, lead_id, phone, email, expires_at)
  VALUES (_student_id, v_student.lead_id, v_phone, NULLIF(v_student.email,''), now() + interval '7 days')
  RETURNING token INTO v_token;

  SELECT value INTO v_base FROM public._app_config WHERE key = 'student_portal_base';

  RETURN jsonb_build_object(
    'token', v_token,
    'url',   COALESCE(v_base, 'https://uni.nimt.ac.in/student') || '?token=' || v_token,
    'phone', v_phone,
    'expires_at', (now() + interval '7 days')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_student_login_link(uuid) TO authenticated, service_role;
