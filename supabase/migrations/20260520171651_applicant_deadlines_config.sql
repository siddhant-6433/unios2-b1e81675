-- Applicant-facing deadline variables stored in _app_config so super_admin
-- can extend them in one shot for every active offer.
--
-- Two keys:
--   • fee_submission_deadline      — last date to (a) pay the first-year
--     pending fee and (b) avail the 1-year fee conversion / additional
--     scholarship. Shown on the applicant portal as a plain calendar date
--     (no countdown).
--   • full_course_payment_deadline — last date the "Pay all course fees at
--     one go" lump-sum CTA is offered. After this date, only year-1 lump
--     sum is offered.
--
-- The applicant portal reads these via the anon-callable
-- get_applicant_deadlines() RPC; super_admin writes via the
-- set_applicant_deadline() admin RPC.

INSERT INTO public._app_config (key, value) VALUES
  ('fee_submission_deadline',      '2026-06-10'),
  ('full_course_payment_deadline', '2026-09-15')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_applicant_deadlines()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_object_agg(key, value) INTO v_result
  FROM public._app_config
  WHERE key IN ('fee_submission_deadline', 'full_course_payment_deadline');
  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_deadlines() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_applicant_deadline(_key text, _value date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _key NOT IN ('fee_submission_deadline', 'full_course_payment_deadline') THEN
    RAISE EXCEPTION 'unknown deadline key: %', _key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'only super_admin can update applicant deadlines';
  END IF;

  INSERT INTO public._app_config (key, value) VALUES (_key, _value::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_applicant_deadline(text, date) TO authenticated;
