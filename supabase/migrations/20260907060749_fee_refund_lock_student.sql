-- When a fee refund is paid: mark the student Refunded, disable their login,
-- and hide applicant-portal offer letters + fee receipts. Super admin can
-- re-enable login (which also clears the Refunded badge).
--
-- Mirrors students.archived_at: a nullable timestamp that overrides the badge
-- without enum surgery on student_status.

-- 1. Marker -------------------------------------------------------------------
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_students_refunded_at
  ON public.students (refunded_at) WHERE refunded_at IS NOT NULL;

COMMENT ON COLUMN public.students.refunded_at IS
  'Set when any fee refund reaches paid. Overrides the roster/profile badge to Refunded. Cleared when a super admin re-enables login.';

-- 2. Shared gate: this lead's student has had access revoked ------------------
CREATE OR REPLACE FUNCTION public.student_admission_access_revoked(_lead_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _lead_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.students s
     WHERE s.lead_id = _lead_id
       AND s.deleted_at IS NULL
       AND (s.login_disabled OR s.refunded_at IS NOT NULL)
  );
$function$;
GRANT EXECUTE ON FUNCTION public.student_admission_access_revoked(uuid) TO anon, authenticated, service_role;

-- 3. Lock the student (badge + login + kick live sessions) --------------------
-- No role check: only called from the paid-refund trigger (DEFINER) or the
-- backfill below. Session revoke is inlined because admin_revoke_user_sessions
-- requires super_admin when auth.uid() is set (accountant mark-paid would fail).
CREATE OR REPLACE FUNCTION public.lock_student_after_fee_refund(_student_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user_id uuid;
  v_was_disabled boolean;
  v_had_refunded timestamptz;
BEGIN
  SELECT user_id, login_disabled, refunded_at
    INTO v_user_id, v_was_disabled, v_had_refunded
    FROM public.students
   WHERE id = _student_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.students
     SET refunded_at = COALESCE(refunded_at, now()),
         login_disabled = true
   WHERE id = _student_id;

  IF v_user_id IS NOT NULL THEN
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = v_user_id;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
    DELETE FROM auth.refresh_tokens WHERE user_id = v_user_id;
  END IF;

  IF v_had_refunded IS NULL THEN
    INSERT INTO public.student_audit_log
      (student_id, actor_user_id, event_type, field_name, old_value, new_value, reason)
    VALUES
      (_student_id, auth.uid(), 'refunded', 'refunded_at', NULL, now()::text, 'Paid fee refund');
  END IF;

  IF NOT COALESCE(v_was_disabled, false) THEN
    INSERT INTO public.student_audit_log
      (student_id, actor_user_id, event_type, field_name, old_value, new_value, reason)
    VALUES
      (_student_id, auth.uid(), 'login_disabled', 'login_disabled', 'false', 'true', 'Paid fee refund');
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_student_after_fee_refund(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_student_after_fee_refund(uuid) TO service_role;

-- 4. Hook the existing paid-refund trigger -----------------------------------
CREATE OR REPLACE FUNCTION public.apply_fee_refund_on_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_item RECORD;
BEGIN
  IF NEW.status = 'paid' AND COALESCE(OLD.status, '') <> 'paid' THEN
    FOR v_item IN
      SELECT fee_ledger_id, SUM(amount) AS amt
        FROM public.fee_refund_items
       WHERE refund_id = NEW.id
       GROUP BY fee_ledger_id
    LOOP
      UPDATE public.fee_ledger
         SET paid_amount = GREATEST(paid_amount - v_item.amt, 0),
             status = CASE
               WHEN (total_amount - concession - GREATEST(paid_amount - v_item.amt, 0)) <= 0 THEN 'paid'
               WHEN due_date < current_date THEN 'overdue'
               ELSE 'due' END,
             updated_at = now()
       WHERE id = v_item.fee_ledger_id;
    END LOOP;

    PERFORM public.lock_student_after_fee_refund(NEW.student_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.apply_fee_refund_on_paid() FROM PUBLIC, anon, authenticated;

-- 5. Super-admin re-enable also clears the Refunded badge ---------------------
CREATE OR REPLACE FUNCTION public.admin_set_student_login_disabled(
  _student_id uuid,
  _disabled   boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_old     boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can change student login access';
  END IF;

  SELECT user_id, login_disabled INTO v_user_id, v_old
    FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF _disabled THEN
    UPDATE public.students
       SET login_disabled = true
     WHERE id = _student_id;
  ELSE
    -- Re-enable: restore portal access and drop the Refunded badge.
    UPDATE public.students
       SET login_disabled = false,
           refunded_at = NULL
     WHERE id = _student_id;
  END IF;

  IF _disabled AND v_user_id IS NOT NULL THEN
    PERFORM public.admin_revoke_user_sessions(v_user_id);
  END IF;

  INSERT INTO public.student_audit_log
    (student_id, actor_user_id, event_type, field_name, old_value, new_value)
  VALUES
    (_student_id, auth.uid(),
     CASE WHEN _disabled THEN 'login_disabled' ELSE 'login_enabled' END,
     'login_disabled', COALESCE(v_old, false)::text, _disabled::text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_student_login_disabled(uuid, boolean) TO authenticated;

-- 6. Surface refunded_at on the staff profile RPC -----------------------------
CREATE OR REPLACE FUNCTION public.student_profile_for_viewer(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  s             public.students%ROWTYPE;
  v_perms       text[];
  v_super       boolean;
  v_teacher     boolean;
  v_nodal       boolean;
  v_contact     boolean;
  v_medical     boolean;
  v_sensitive   boolean;
  v_out         jsonb;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_super   := public.has_role(auth.uid(), 'super_admin');
  v_perms   := public.get_user_permissions(auth.uid());
  v_teacher := public.has_role(auth.uid(), 'teacher')
            OR public.has_role(auth.uid(), 'faculty');
  v_nodal   := public.is_class_teacher_of(auth.uid(), _student_id);

  v_contact   := v_super OR ('students:view_contact'   = ANY(v_perms) AND (NOT v_teacher OR v_nodal));
  v_medical   := v_super OR ('students:view_medical'   = ANY(v_perms) AND (NOT v_teacher OR v_nodal));
  v_sensitive := v_super OR ('students:view_sensitive' = ANY(v_perms) AND NOT v_teacher);

  v_out := jsonb_build_object(
    'id', s.id, 'name', s.name,
    'first_name', s.first_name, 'middle_name', s.middle_name, 'last_name', s.last_name,
    'admission_no', s.admission_no, 'pre_admission_no', s.pre_admission_no,
    'school_admission_no', s.school_admission_no, 'sr_number', s.sr_number,
    'class_roll_no', s.class_roll_no, 'section', s.section, 'joining_class', s.joining_class,
    'house', s.house, 'status', s.status, 'student_type', s.student_type,
    'gender', s.gender, 'dob', s.dob,
    'batch_id', s.batch_id, 'session_id', s.session_id,
    'course_id', s.course_id, 'campus_id', s.campus_id,
    'photo_url', s.photo_url, 'photo_processed_url', s.photo_processed_url,
    'second_language', s.second_language, 'third_language', s.third_language,
    'is_class_teacher', v_nodal,
    'login_disabled', s.login_disabled,
    'archived_at', s.archived_at,
    'refunded_at', s.refunded_at
  );

  IF v_contact THEN
    v_out := v_out || jsonb_build_object(
      'phone', s.phone, 'whatsapp_no', s.whatsapp_no,
      'email', s.email, 'student_email', s.student_email, 'school_email', s.school_email,
      'address', s.address, 'city', s.city, 'state', s.state, 'pincode', s.pincode,
      'father_name', s.father_name, 'father_phone', s.father_phone,
      'father_whatsapp', s.father_whatsapp, 'father_email', s.father_email,
      'mother_name', s.mother_name, 'mother_phone', s.mother_phone,
      'mother_whatsapp', s.mother_whatsapp, 'mother_email', s.mother_email,
      'guardian_name', s.guardian_name, 'guardian_phone', s.guardian_phone,
      'mother_tongue', s.mother_tongue
    );
  END IF;

  IF v_medical THEN
    v_out := v_out || jsonb_build_object(
      'blood_group', s.blood_group,
      'allergies_food', s.allergies_food, 'allergies_medicine', s.allergies_medicine,
      'medical_ailments', s.medical_ailments, 'ongoing_treatment', s.ongoing_treatment,
      'physical_handicap', s.physical_handicap, 'is_asthmatic', s.is_asthmatic,
      'vision', s.vision
    );
  END IF;

  IF v_sensitive THEN
    v_out := v_out || jsonb_build_object(
      'student_aadhar', s.student_aadhar,
      'father_aadhar', s.father_aadhar, 'mother_aadhar', s.mother_aadhar,
      'father_income', s.father_income, 'father_occupation', s.father_occupation,
      'father_organization', s.father_organization, 'father_designation', s.father_designation,
      'father_qualification', s.father_qualification,
      'mother_occupation', s.mother_occupation, 'mother_organization', s.mother_organization,
      'bank_name', s.bank_name, 'bank_account_no', s.bank_account_no, 'ifsc_code', s.ifsc_code,
      'religion', s.religion, 'caste', s.caste, 'sub_caste', s.sub_caste,
      'caste_category', s.caste_category,
      'concession_category', s.concession_category, 'fee_profile_type', s.fee_profile_type,
      'fee_remarks', s.fee_remarks, 'rte_student', s.rte_student,
      'biometric_id', s.biometric_id, 'apaar_id', s.apaar_id,
      'pen', s.pen, 'udise', s.udise,
      'identification_marks_1', s.identification_marks_1,
      'identification_marks_2', s.identification_marks_2
    );
  END IF;

  RETURN v_out;
END;
$function$;

-- 7. Hide offer letters + applicant receipts when access is revoked -----------
CREATE OR REPLACE FUNCTION public.get_applicant_offers_by_phone(_phone text)
RETURNS TABLE (
  lead_id         uuid,
  course_id       uuid,
  letter_url      text,
  loan_letter_url text,
  approval_status text,
  created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _phone IS NULL OR btrim(_phone) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ol.lead_id)
         ol.lead_id,
         ol.course_id,
         ol.letter_url,
         ol.loan_letter_url,
         ol.approval_status,
         ol.created_at
  FROM   public.offer_letters ol
  JOIN   public.leads l ON l.id = ol.lead_id
  WHERE  ol.approval_status = 'approved'
    AND  NOT public.student_admission_access_revoked(ol.lead_id)
    AND  (
           l.phone = _phone
           OR EXISTS (
             SELECT 1
             FROM public.applications a
             WHERE a.lead_id = ol.lead_id
               AND a.phone = _phone
           )
         )
  ORDER  BY ol.lead_id, ol.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offers_by_phone(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_applicant_offer(_application_id text)
RETURNS TABLE (
  id                  uuid,
  lead_id             uuid,
  total_fee           numeric,
  scholarship_amount  numeric,
  net_fee             numeric,
  token_fee_amount    numeric,
  approval_status     text,
  status              text,
  acceptance_deadline date,
  created_at          timestamptz,
  letter_url          text,
  loan_letter_url     text,
  admission_mode      text,
  entrance_exam_name  text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ol.id, ol.lead_id, ol.total_fee, ol.scholarship_amount,
         ol.net_fee, ol.token_fee_amount, ol.approval_status, ol.status,
         ol.acceptance_deadline, ol.created_at, ol.letter_url, ol.loan_letter_url,
         ol.admission_mode, ol.entrance_exam_name
  FROM   public.offer_letters ol
  JOIN   public.applications  a  ON a.lead_id = ol.lead_id
  WHERE  a.application_id  = _application_id
    AND  ol.approval_status = 'approved'
    AND  NOT public.student_admission_access_revoked(ol.lead_id)
  ORDER  BY ol.created_at DESC
  LIMIT  1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offer(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_applicant_payments(_lead_id uuid)
RETURNS TABLE (
  id              uuid,
  receipt_no      text,
  type            text,
  amount          numeric,
  concession_amount numeric,
  payment_mode    text,
  transaction_ref text,
  status          text,
  payment_date    timestamptz,
  created_at      timestamptz,
  receipt_url     text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.student_admission_access_revoked(_lead_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    lp.id, lp.receipt_no, lp.type::text, lp.amount, lp.concession_amount,
    lp.payment_mode::text, lp.transaction_ref, lp.status::text,
    lp.payment_date, lp.created_at, lp.receipt_url
  FROM public.lead_payments lp
  WHERE lp.lead_id = _lead_id
  ORDER BY lp.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_payments(uuid) TO anon, authenticated;

-- 8. Backfill students who already have a paid refund -------------------------
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT DISTINCT student_id
      FROM public.fee_refunds
     WHERE status = 'paid'
  LOOP
    PERFORM public.lock_student_after_fee_refund(v_id);
  END LOOP;
END $$;
