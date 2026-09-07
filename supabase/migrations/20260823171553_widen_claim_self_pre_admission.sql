-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260823171553 name=widen_claim_self_pre_admission applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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

  SELECT id INTO v_student_id FROM public.students WHERE user_id = v_uid LIMIT 1;
  IF v_student_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'student')
      ON CONFLICT (user_id, role) DO NOTHING;
    RETURN jsonb_build_object('linked', true, 'already', true, 'student_id', v_student_id);
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'has_role');
  END IF;

  SELECT phone, email INTO v_phone, v_email FROM auth.users WHERE id = v_uid;
  v_phone10 := right(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g'), 10);
  IF (v_phone10 = '' OR length(v_phone10) < 10) AND COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'no_identity');
  END IF;

  SELECT count(*), min(id) INTO v_match_count, v_student_id
  FROM public.students s
  WHERE (
      s.admission_no IS NOT NULL
      OR (s.pre_admission_no IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.fee_ledger fl WHERE fl.student_id = s.id))
    )
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
