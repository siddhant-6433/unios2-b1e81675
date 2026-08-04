-- Generate the student login link first, send it second.
--
-- issue_student_login_link inserted a student_magic_tokens row, and the
-- ON INSERT trigger fired WhatsApp immediately — so a cashier who only wanted
-- to read the URL out at the counter, or paste it into another channel, had
-- already messaged the parent by the time the button finished. Delivery is now
-- a separate, deliberate step.
--
-- Kept as one code path: the send body moves out of the trigger into
-- send_student_claim_link(token_id), which both the trigger (for the automatic
-- AN-issuance path) and the new on-demand RPC call.

-- auto_send defaults TRUE, so every existing insert site — AN issuance, PAN
-- promotion, the lifecycle notifiers — keeps behaving exactly as before.
ALTER TABLE public.student_magic_tokens
  ADD COLUMN IF NOT EXISTS auto_send boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.student_magic_tokens.auto_send IS
  'When true (default) the insert trigger sends the claim link over WhatsApp. '
  'The cashier counter mints with false and sends explicitly via send_student_login_link().';

-- ── Delivery, callable on its own ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_student_claim_link(_token_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok           public.student_magic_tokens%ROWTYPE;
  v_supa_url      text;
  v_service_key   text;
  v_portal_base   text;
  v_claim_url     text;
  v_student_name  text;
  v_admission_no  text;
BEGIN
  SELECT * INTO v_tok FROM public.student_magic_tokens WHERE id = _token_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'token not found');
  END IF;
  IF v_tok.phone IS NULL OR v_tok.phone = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no phone on the token');
  END IF;

  SELECT value INTO v_supa_url    FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'send_student_claim_link: _app_config missing supabase_url or service_role_key';
    RETURN jsonb_build_object('sent', false, 'reason', 'messaging not configured');
  END IF;

  SELECT value INTO v_portal_base FROM public._app_config WHERE key = 'student_portal_base';
  v_claim_url := COALESCE(v_portal_base, 'https://uni.nimt.ac.in/student') || '?token=' || v_tok.token;

  SELECT name, admission_no INTO v_student_name, v_admission_no
    FROM public.students WHERE id = v_tok.student_id;

  -- Body params (positional): student_name, admission_no
  -- Button URL gets the claim link appended as the dynamic suffix.
  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/whatsapp-send',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'template_key', 'student_portal_invite',
      'phone',        v_tok.phone,
      'lead_id',      v_tok.lead_id,
      'params',       jsonb_build_array(
        COALESCE(v_student_name, 'Student'),
        COALESCE(v_admission_no, '')
      ),
      'button_urls',  jsonb_build_array(v_claim_url)
    )
  );

  -- Log the URL so admin can resend manually if WA delivery failed.
  IF v_tok.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (v_tok.lead_id, 'system',
            'Student-portal claim link sent via WhatsApp: ' || v_claim_url);
  END IF;

  RETURN jsonb_build_object('sent', true, 'phone', v_tok.phone, 'url', v_claim_url);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'send_student_claim_link failed for token %: %', _token_id, SQLERRM;
  RETURN jsonb_build_object('sent', false, 'reason', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.send_student_claim_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_student_claim_link(uuid) TO service_role;

-- ── Trigger now just decides whether to deliver ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_send_student_claim_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.auto_send IS FALSE THEN
    RETURN NEW;  -- minted at the counter; the cashier sends it deliberately
  END IF;
  PERFORM public.send_student_claim_link(NEW.id);
  RETURN NEW;
END;
$$;

-- ── Mint without sending ─────────────────────────────────────────────────────
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
          OR public.has_role(auth.uid(), 'super_admin')) THEN
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

-- ── Send it, when the cashier says so ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_student_login_link(_token_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok public.student_magic_tokens%ROWTYPE;
BEGIN
  IF NOT (public.can_collect_fee(auth.uid())
          OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised to send a student login link'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_tok FROM public.student_magic_tokens WHERE id = _token_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Login link not found';
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

GRANT EXECUTE ON FUNCTION public.send_student_login_link(uuid) TO authenticated, service_role;
