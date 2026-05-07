-- ====================================================================
-- 1. lead_year_fees_net — per-year fees net of approved offer waivers
--    (TokenFeePanel uses this for concession_breakdown calculations so
--     the discount sent to EaseBuzz is based on what the candidate
--     actually owes, not the gross fee structure amount.)
--
-- 2. Auto-provision fee ledger when a student is first admitted (gets
--    an admission_no). Fires provision-student-fees via pg_net so the
--    ledger is always ready without manual "Auto-Assign Fees" clicks.
-- ====================================================================

-- 1. lead_year_fees_net ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_year_fees_net(_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(y.term, GREATEST(0, y.total - COALESCE(w.waiver_sum, 0))),
    '{}'::jsonb
  )
  FROM (
    SELECT fsi.term, SUM(fsi.amount)::numeric AS total
      FROM public.fee_structure_items fsi
     WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
       AND fsi.term LIKE 'year\_%' ESCAPE '\'
     GROUP BY fsi.term
  ) y
  LEFT JOIN (
    SELECT ow.term, SUM(ow.amount)::numeric AS waiver_sum
      FROM public.offer_waivers ow
      JOIN public.offer_letters ol ON ol.id = ow.offer_letter_id
     WHERE ol.lead_id    = _lead_id
       AND ol.approval_status = 'approved'
       AND ow.status     = 'approved'
       AND ow.term LIKE 'year\_%' ESCAPE '\'
     GROUP BY ow.term
  ) w ON w.term = y.term;
$$;

GRANT EXECUTE ON FUNCTION public.lead_year_fees_net(uuid) TO anon, authenticated, service_role;

-- 2. Auto-provision fee ledger on first admission --------------------------
-- Fires when students.admission_no transitions from NULL → non-NULL.
-- Uses pg_net (async HTTP) so the transaction never blocks.
CREATE OR REPLACE FUNCTION public.auto_provision_fees_on_admission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url  text;
  v_key  text;
BEGIN
  -- Only fire on the first assignment of admission_no (NULL → value).
  IF NEW.admission_no IS NULL OR OLD.admission_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[auto_provision_fees] _app_config missing supabase_url or service_role_key; skipping auto-provision for student %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/provision-student-fees',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('student_id', NEW.id)::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_provision_fees_on_admission ON public.students;
CREATE TRIGGER trg_auto_provision_fees_on_admission
  AFTER UPDATE OF admission_no ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_provision_fees_on_admission();
