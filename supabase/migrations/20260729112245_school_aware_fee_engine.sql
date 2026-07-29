-- School-aware fee engine: make the token / 25%-AN milestone work for schools.
--
-- Bug: lead_first_year_fee sums fee_structure_items.term='year_1',
-- lead_total_course_fee sums term LIKE 'year_%', and lead_post_scholarship_year_1
-- subtracts offer_waivers only where term='year_1'. School fee structures use
-- terms admission/q1..q4/registration, so all three return 0 for every school
-- student. lead_fee_status gates twenty_five_complete on post_year_1 > 0, so no
-- school student can ever reach the 25%/AN (admitted) milestone. (The token/PAN
-- milestone works only because token_required reads offer_letters.token_fee_amount.)
--
-- Owner's rule for schools: annual fee base = admission + q1..q4 of the
-- mode-selected items; the refundable security deposit is EXCLUDED (paid
-- separately). Token and 25% compute against that base, net of approved waivers.
--
-- Design: the offer already stores the mode-selected annual fee. total_fee is the
-- mode-selected annual incl. deposit (computed by the UI's includeOfferFeeItem);
-- net_fee = total_fee - scholarship - approved waivers (kept current by the
-- recalculate_offer_letter_net_fee trigger, 20260623120000, for waivers of ANY
-- term). So the school branch reuses those stored totals and only subtracts the
-- boarding deposit — no re-implementation of the mode filter in SQL, brand-agnostic
-- (matches the deposit by the 'SEC' suffix, like SECURITY_DEPOSIT_CODE_SUFFIX).
-- College branches are byte-identical to the prior definitions.

-- 1. Boarding deposit to exclude from the school annual base --------------------
--    Refundable *SEC deposit is a boarders-only, paid-separately item. Matches by
--    code suffix so it covers NB-SEC / MR-SEC / any future brand.
CREATE OR REPLACE FUNCTION public.lead_school_boarding_deposit(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (
      SELECT ol.student_type
        FROM public.offer_letters ol
       WHERE ol.lead_id = _lead_id
         AND ol.approval_status = 'approved'
       ORDER BY ol.created_at DESC
       LIMIT 1
    ) = 'boarder'
    THEN COALESCE((
      SELECT SUM(fsi.amount)
        FROM public.fee_structure_items fsi
        JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
       WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
         AND UPPER(fc.code) LIKE '%SEC'
    ), 0)::numeric
    ELSE 0::numeric
  END;
$function$;

-- 2. lead_first_year_fee — school branch uses the offer's mode-selected annual ---
CREATE OR REPLACE FUNCTION public.lead_first_year_fee(_lead_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_course_id uuid;
  v_total     numeric;
BEGIN
  SELECT course_id INTO v_course_id FROM public.leads WHERE id = _lead_id;

  IF public.student_course_is_school(v_course_id) THEN
    -- School annual base = latest approved offer's mode-selected total (incl.
    -- deposit) minus the refundable boarding deposit (paid separately).
    SELECT ol.total_fee
      INTO v_total
      FROM public.offer_letters ol
     WHERE ol.lead_id = _lead_id
       AND ol.approval_status = 'approved'
     ORDER BY ol.created_at DESC
     LIMIT 1;
    RETURN GREATEST(0, COALESCE(v_total, 0) - public.lead_school_boarding_deposit(_lead_id));
  END IF;

  -- College: unchanged (sum of year_1 fee-structure items).
  RETURN (
    SELECT COALESCE(SUM(fsi.amount), 0)::numeric
    FROM public.fee_structure_items fsi
    WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
      AND fsi.term = 'year_1'
  );
END;
$function$;

-- 3. lead_post_scholarship_year_1 — school branch uses net_fee (nets all waivers) -
CREATE OR REPLACE FUNCTION public.lead_post_scholarship_year_1(_lead_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_course_id    uuid;
  v_net          numeric;
  v_y1           numeric;
  v_offer_id     uuid;
  v_waivers      numeric := 0;
  v_scholarship  numeric := 0;
BEGIN
  SELECT course_id INTO v_course_id FROM public.leads WHERE id = _lead_id;

  IF public.student_course_is_school(v_course_id) THEN
    -- offer.net_fee already = total - scholarship - approved waivers (any term),
    -- kept current by recalculate_offer_letter_net_fee. The 25% base excludes the
    -- boarding deposit, so subtract the structural deposit but ADD BACK any waiver
    -- applied to the deposit term — otherwise a deposit waiver is double-counted
    -- (once inside net_fee, once in the deposit subtraction).
    SELECT ol.id, ol.net_fee
      INTO v_offer_id, v_net
      FROM public.offer_letters ol
     WHERE ol.lead_id = _lead_id
       AND ol.approval_status = 'approved'
     ORDER BY ol.created_at DESC
     LIMIT 1;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_waivers
      FROM public.offer_waivers
     WHERE offer_letter_id = v_offer_id
       AND status = 'approved'
       AND term   = 'security_deposit';

    RETURN GREATEST(0, COALESCE(v_net, 0) - public.lead_school_boarding_deposit(_lead_id) + v_waivers);
  END IF;

  -- College: unchanged (year_1 fee minus year_1 waivers / scholarship fallback).
  v_y1 := public.lead_first_year_fee(_lead_id);

  SELECT id, COALESCE(scholarship_amount, 0)
    INTO v_offer_id, v_scholarship
    FROM public.offer_letters
   WHERE lead_id = _lead_id
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_offer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0)
      INTO v_waivers
      FROM public.offer_waivers
     WHERE offer_letter_id = v_offer_id
       AND status          = 'approved'
       AND term            = 'year_1';

    IF v_waivers = 0 THEN
      v_waivers := v_scholarship;
    END IF;
  END IF;

  RETURN GREATEST(0, v_y1 - LEAST(v_waivers, v_y1));
END;
$function$;

-- 4. lead_total_course_fee — schools are annual (q1..q4), so total = first year --
CREATE OR REPLACE FUNCTION public.lead_total_course_fee(_lead_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_course_id uuid;
BEGIN
  SELECT course_id INTO v_course_id FROM public.leads WHERE id = _lead_id;

  IF public.student_course_is_school(v_course_id) THEN
    -- 1-year school programme: total course fee = the annual base.
    RETURN public.lead_first_year_fee(_lead_id);
  END IF;

  -- College: unchanged (sum of all year_N fee-structure items).
  RETURN (
    SELECT COALESCE(SUM(fsi.amount), 0)::numeric
    FROM public.fee_structure_items fsi
    WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
      AND fsi.term LIKE 'year\_%' ESCAPE '\'
  );
END;
$function$;

-- 5. Recompute stage on offer/waiver revision ----------------------------------
--    recompute_lead_fee_stage was only triggered by lead_payments changes, so a
--    waiver approval / offer edit never re-evaluated PAN/AN until the next
--    payment. These triggers close that gap. recompute_lead_fee_stage is
--    promotion-only (guards pre_admission_no/admission_no IS NULL) and idempotent,
--    and never writes offer_letters/offer_waivers, so no trigger recursion.
CREATE OR REPLACE FUNCTION public.recompute_stage_on_waiver_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid;
BEGIN
  SELECT lead_id INTO v_lead
    FROM public.offer_letters
   WHERE id = COALESCE(NEW.offer_letter_id, OLD.offer_letter_id);
  IF v_lead IS NOT NULL THEN
    PERFORM public.recompute_lead_fee_stage(v_lead);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_stage_on_offer_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    PERFORM public.recompute_lead_fee_stage(NEW.lead_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recompute_stage_on_waiver ON public.offer_waivers;
CREATE TRIGGER trg_recompute_stage_on_waiver
  AFTER INSERT OR UPDATE OR DELETE ON public.offer_waivers
  FOR EACH ROW EXECUTE FUNCTION public.recompute_stage_on_waiver_change();

DROP TRIGGER IF EXISTS trg_recompute_stage_on_offer ON public.offer_letters;
CREATE TRIGGER trg_recompute_stage_on_offer
  AFTER UPDATE OF net_fee, total_fee, token_fee_amount, approval_status
  ON public.offer_letters
  FOR EACH ROW EXECUTE FUNCTION public.recompute_stage_on_offer_change();

-- 6. recompute_lead_fee_stage — sync the school student's fee MODE from the offer.
--    provision-student-fees / auto_provision_fees_on_admission read the student's
--    student_type/hostel_type/transport_zone; if they aren't copied from the offer
--    the ledger is billed as a day-scholar (no boarding tier). Set them on student
--    creation and re-sync before the AN branch issues admission_no (which fires
--    provisioning). Otherwise byte-identical to the prior definition.
CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status        jsonb;
  v_lead          public.leads%ROWTYPE;
  v_pan           text;
  v_an            text;
  v_student_id    uuid;
  v_token         text;
  v_is_school     boolean;
  v_session_name  text;
  v_st            text;  -- offer student_type
  v_ht            text;  -- offer hostel_type
  v_tz            text;  -- offer transport_zone
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := public.lead_fee_status(_lead_id);

  -- Offer is the source of truth for the school fee mode.
  SELECT student_type, hostel_type, transport_zone
    INTO v_st, v_ht, v_tz
    FROM public.offer_letters
   WHERE lead_id = _lead_id AND approval_status = 'approved'
   ORDER BY created_at DESC LIMIT 1;

  -- Token complete: PAN + student row + notify pan_issued -----------------
  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview',
                          'application_in_progress','application_fee_paid','application_submitted') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_lead.id;
    IF v_student_id IS NULL THEN
      v_is_school := public.student_course_is_school(v_lead.course_id);

      IF v_is_school THEN
        SELECT name INTO v_session_name FROM public.admission_sessions WHERE id = v_lead.session_id;

        INSERT INTO public.students (
          name, phone, email, guardian_name, guardian_phone,
          course_id, campus_id, lead_id, session_id,
          pre_admission_no, status,
          admission_date, joining_academic_year,
          student_type, hostel_type, transport_zone, transport_required
        ) VALUES (
          v_lead.name, v_lead.phone, v_lead.email,
          v_lead.guardian_name, v_lead.guardian_phone,
          v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
          v_pan, 'pre_admitted',
          CURRENT_DATE, COALESCE(v_session_name, to_char(CURRENT_DATE, 'YYYY')),
          COALESCE(v_st, 'day_scholar'), v_ht, v_tz, (v_tz IS NOT NULL)
        ) RETURNING id INTO v_student_id;
      ELSE
        INSERT INTO public.students (
          name, phone, email, guardian_name, guardian_phone,
          course_id, campus_id, lead_id, session_id,
          pre_admission_no, status
        ) VALUES (
          v_lead.name, v_lead.phone, v_lead.email,
          v_lead.guardian_name, v_lead.guardian_phone,
          v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
          v_pan, 'pre_admitted'
        ) RETURNING id INTO v_student_id;
      END IF;
    ELSE
      UPDATE public.students
         SET pre_admission_no = COALESCE(pre_admission_no, v_pan),
             status = COALESCE(status, 'pre_admitted')
       WHERE id = v_student_id;
      SELECT pre_admission_no INTO v_pan FROM public.students WHERE id = v_student_id;
    END IF;

    UPDATE public.leads SET pre_admission_no = v_pan, stage = 'token_paid' WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion', 'Token fee complete — Pre-admitted with PAN: ' || v_pan, 'token_paid');

    PERFORM public.fn_notify_event('pan_issued', v_lead.id, jsonb_build_object('pre_admission_no', v_pan));

    SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  END IF;

  -- Sync the school student's fee mode with the approved offer BEFORE the AN
  -- branch issues admission_no (which fires auto_provision_fees_on_admission).
  IF public.student_course_is_school(v_lead.course_id) THEN
    UPDATE public.students
       SET student_type      = COALESCE(v_st, student_type, 'day_scholar'),
           hostel_type        = v_ht,
           transport_zone     = v_tz,
           transport_required = (v_tz IS NOT NULL)
     WHERE lead_id = v_lead.id;
  END IF;

  -- 25% threshold: AN + magic token --------------------------------------
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_has_rejected_doc(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system', 'AN provisioning blocked — one or more documents are rejected. Resolve rejections to issue AN.');
      RETURN;
    END IF;

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students SET admission_no = COALESCE(admission_no, v_an), status = 'active'
     WHERE lead_id = v_lead.id RETURNING admission_no, id INTO v_an, v_student_id;

    UPDATE public.leads SET admission_no = v_an, stage = 'admitted' WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion', '25% fee paid — Admitted with AN: ' || v_an, 'admitted');

    IF v_student_id IS NOT NULL THEN
      INSERT INTO public.student_magic_tokens (student_id, lead_id, phone, email, expires_at)
      VALUES (v_student_id, v_lead.id, v_lead.phone, v_lead.email, now() + interval '30 days')
      RETURNING token INTO v_token;

      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system', 'Student-portal claim link generated (valid 30 days).');
    END IF;
  END IF;
END;
$function$;

-- 7. Backfill: recompute every school lead with an approved offer --------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ol.lead_id
      FROM public.offer_letters ol
      JOIN public.leads l ON l.id = ol.lead_id
     WHERE ol.approval_status = 'approved'
       AND public.student_course_is_school(l.course_id)
  LOOP
    BEGIN
      PERFORM public.recompute_lead_fee_stage(r.lead_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'school fee backfill: lead % failed: %', r.lead_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
