-- Let counsellors raise a payment link and a login link for their own students.
--
-- A counsellor could already open Students → <student> → Fee Ledger (the tab is
-- not role-gated) but saw an empty table: fee_ledger's "Finance staff can view
-- all ledger" policy covers super_admin, campus_admin, accountant, principal
-- and campus-scoped office_assistant — no counsellor. So the panel rendered,
-- with nothing in it.
--
-- Scope is deliberately NOT "any student". It reuses can_view_student_via_lead,
-- the exact predicate already behind the "Counsellors can view assigned
-- students" policy on public.students — counsellor/admission_head AND
-- can_view_lead() on the originating lead. Same students they can already see,
-- now with the fee rows attached, and no new notion of "assigned".
--
-- has_role() is evaluated FIRST so the AND short-circuits for every other role:
-- finance dashboards scanning fee_ledger never reach the per-row
-- can_view_lead(), which is a known hotspot.

DROP POLICY IF EXISTS "Counsellors can view assigned student ledger" ON public.fee_ledger;
CREATE POLICY "Counsellors can view assigned student ledger"
  ON public.fee_ledger
  FOR SELECT
  TO authenticated
  USING (
    (public.has_role(auth.uid(), 'counsellor')
     OR public.has_role(auth.uid(), 'admission_head'))
    AND public.can_view_student_via_lead(auth.uid(), student_id)
  );

-- Read-only by design: no INSERT/UPDATE/DELETE policy is added. A counsellor
-- can see what is owed and ask the payer for it; they cannot take cash, edit a
-- head, or remove a row. Those stay with the cashier.

-- ── Login link: same widening, same scope ───────────────────────────────────
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
          -- A counsellor may hand a login link to a candidate they own, and
          -- only to that candidate.
          OR public.can_view_student_via_lead(auth.uid(), _student_id)) THEN
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

  -- Authorise against the token's own student, so a counsellor can only send
  -- links for candidates they own.
  IF NOT (public.can_collect_fee(auth.uid())
          OR public.has_role(auth.uid(), 'super_admin')
          OR public.can_view_student_via_lead(auth.uid(), v_tok.student_id)) THEN
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
