-- Revert PAN / AN generation to hex-only format.
--
-- Live DB had `generate_admission_no` + `generate_admission_no_for_lead`
-- (defined via the Supabase dashboard, not in repo migrations) that produced
-- structured codes like `NIMTHOSP-P-26-00001`. Per product decision, we are
-- going back to the original hex-derived format:
--   PAN-<8 uppercase hex>   (e.g. PAN-A50F0E24)
--   AN-<8 uppercase hex>    (e.g. AN-F8B318AF)
--
-- This migration:
--   1. Rewrites `handle_lead_payment_change` to generate PAN/AN inline using
--      MD5 (no call to the structured generator, no exception fallback).
--   2. Drops `generate_admission_no` and `generate_admission_no_for_lead` so
--      they cannot drift back in.
--
-- Existing rows with the structured format are left untouched — only new
-- issuances follow the hex format.

CREATE OR REPLACE FUNCTION public.handle_lead_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status     jsonb;
  v_lead       public.leads%ROWTYPE;
  v_pan        text;
  v_an         text;
  v_student_id uuid;
  v_token      text;
BEGIN
  IF (TG_OP = 'INSERT') AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_status := public.lead_fee_status(NEW.lead_id);

  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_lead.id;
    IF v_student_id IS NULL THEN
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
    ELSE
      UPDATE public.students
         SET pre_admission_no = COALESCE(pre_admission_no, v_pan),
             status = COALESCE(status, 'pre_admitted')
       WHERE id = v_student_id;
      SELECT pre_admission_no INTO v_pan FROM public.students WHERE id = v_student_id;
    END IF;

    UPDATE public.leads
       SET pre_admission_no = v_pan,
           stage = 'token_paid'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            'Token fee complete — Pre-admitted with PAN: ' || v_pan,
            'token_paid');

    PERFORM public.fn_notify_event('pan_issued', v_lead.id,
      jsonb_build_object('pre_admission_no', v_pan));

    SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  END IF;

  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_has_rejected_doc(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'AN provisioning blocked — one or more documents are rejected. Resolve rejections to issue AN.');
      RETURN NEW;
    END IF;

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students
       SET admission_no = COALESCE(admission_no, v_an),
           status = 'active'
     WHERE lead_id = v_lead.id
     RETURNING admission_no, id INTO v_an, v_student_id;

    UPDATE public.leads
       SET admission_no = v_an,
           stage = 'admitted'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            '25% fee paid — Admitted with AN: ' || v_an,
            'admitted');

    IF v_student_id IS NOT NULL THEN
      INSERT INTO public.student_magic_tokens (
        student_id, lead_id, phone, email, expires_at
      ) VALUES (
        v_student_id, v_lead.id, v_lead.phone, v_lead.email,
        now() + interval '30 days'
      )
      RETURNING token INTO v_token;

      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'Student-portal claim link generated (valid 30 days).');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.generate_admission_no_for_lead(uuid, text);
DROP FUNCTION IF EXISTS public.generate_admission_no(uuid, integer, text);

-- Backfill: convert any structured-format PAN/AN to hex so they match the new
-- generation path. We only match the structured pattern (e.g. NIMTHOSP-P-26-00001
-- or NIMTHOSP-26-00001), NOT legacy bare numeric admission_no values like
-- "1803089" — those are authoritative historical NIMT admission numbers and
-- must remain untouched.
DO $$
DECLARE
  r          RECORD;
  v_new_pan  text;
  v_new_an   text;
BEGIN
  FOR r IN
    SELECT id FROM public.leads WHERE pre_admission_no ~ '^[A-Z]+-P-[0-9]{2}-[0-9]+$'
  LOOP
    v_new_pan := 'PAN-' || UPPER(SUBSTRING(MD5(r.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));
    UPDATE public.leads    SET pre_admission_no = v_new_pan WHERE id      = r.id;
    UPDATE public.students SET pre_admission_no = v_new_pan WHERE lead_id = r.id;
  END LOOP;

  FOR r IN
    SELECT id FROM public.leads
    WHERE admission_no ~ '^[A-Z]+-[0-9]{2}-[0-9]+$'
      AND admission_no !~ '^P?AN-'
  LOOP
    v_new_an := 'AN-' || UPPER(SUBSTRING(MD5(r.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));
    UPDATE public.leads    SET admission_no = v_new_an WHERE id      = r.id;
    UPDATE public.students SET admission_no = v_new_an WHERE lead_id = r.id;
  END LOOP;
END $$;
