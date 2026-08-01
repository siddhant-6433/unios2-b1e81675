-- Self-service student linking. When an admitted candidate logs in (via the
-- apply portal or /login) their auth user is usually NOT yet linked to the
-- students row — AN issuance only mints a magic claim token. So get_user_role
-- returns null and they land on the applicant portal instead of the student
-- dashboard.
--
-- This RPC lets a logged-in user claim their OWN admitted student record by
-- their verified identity (phone from WhatsApp OTP, or email), then grants the
-- 'student' role so post-login routing sends them to /student. It's the
-- automatic counterpart to the emailed magic-token claim (student-portal-claim).
--
-- Safety:
--   * caller must be authenticated; matches ONLY against auth.users' own phone/email
--   * never touches a user who already has any role (so staff are never converted)
--   * only links admitted (admission_no set), UNCLAIMED (user_id IS NULL) students
--   * requires an unambiguous single match (shared phone / siblings -> no auto-link;
--     falls back to the secure magic-token claim)
CREATE OR REPLACE FUNCTION public.claim_admitted_student_self()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_email text;
  v_phone10 text;
  v_student_id uuid;
  v_match_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'not_authenticated');
  END IF;

  -- Already linked to a student? Ensure the role exists and return.
  SELECT id INTO v_student_id FROM public.students WHERE user_id = v_uid LIMIT 1;
  IF v_student_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'student')
      ON CONFLICT (user_id, role) DO NOTHING;
    RETURN jsonb_build_object('linked', true, 'already', true, 'student_id', v_student_id);
  END IF;

  -- Never auto-convert a user who already holds a role (staff/counsellor/etc.).
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'has_role');
  END IF;

  SELECT phone, email INTO v_phone, v_email FROM auth.users WHERE id = v_uid;
  v_phone10 := right(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g'), 10);
  IF (v_phone10 = '' OR length(v_phone10) < 10) AND COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'no_identity');
  END IF;

  -- Find admitted, unclaimed students matching this verified identity.
  SELECT count(*), min(id) INTO v_match_count, v_student_id
  FROM public.students s
  WHERE s.admission_no IS NOT NULL
    AND s.user_id IS NULL
    AND (
      (length(v_phone10) = 10 AND right(regexp_replace(COALESCE(s.phone, ''), '\D', '', 'g'), 10) = v_phone10)
      OR (COALESCE(v_email, '') <> '' AND lower(s.email) = lower(v_email))
    );

  IF v_match_count <> 1 OR v_student_id IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason',
      CASE WHEN v_match_count > 1 THEN 'ambiguous' ELSE 'no_match' END);
  END IF;

  UPDATE public.students SET user_id = v_uid, updated_at = now() WHERE id = v_student_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'student')
    ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object('linked', true, 'already', false, 'student_id', v_student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_admitted_student_self() TO authenticated;
