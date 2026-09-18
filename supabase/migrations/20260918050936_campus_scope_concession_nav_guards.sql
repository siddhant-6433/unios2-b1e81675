-- campus scope concession nav guards
-- Campus-scoped access hardening + concession request guardrails.
--
-- profiles.campus is the current campus-access source of truth. It may contain
-- one or more campus names/codes separated by commas, matching the client-side
-- CampusProvider behavior.

CREATE OR REPLACE FUNCTION public.user_assigned_campus_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH assigned AS (
    SELECT lower(btrim(value)) AS campus_key
    FROM public.profiles p
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(p.campus, ''), '\s*,\s*') AS value
    WHERE p.user_id = _user_id
      AND p.campus IS NOT NULL
      AND btrim(p.campus) <> ''
      AND btrim(value) <> ''
  )
  SELECT COALESCE(array_agg(DISTINCT c.id), ARRAY[]::uuid[])
  FROM assigned a
  JOIN public.campuses c
    ON lower(c.name) = a.campus_key
    OR lower(c.code) = a.campus_key;
$$;

CREATE OR REPLACE FUNCTION public.user_has_campus_scope(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_length(public.user_assigned_campus_ids(_user_id), 1), 0) > 0;
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_assigned_campus(_user_id uuid, _campus_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _campus_id IS NOT NULL
     AND _campus_id = ANY(public.user_assigned_campus_ids(_user_id));
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_record_campus(_user_id uuid, _campus_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'super_admin'::public.app_role)
      OR NOT public.user_has_campus_scope(_user_id)
      OR public.user_can_access_assigned_campus(_user_id, _campus_id);
$$;

GRANT EXECUTE ON FUNCTION public.user_assigned_campus_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_campus_scope(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_assigned_campus(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_record_campus(uuid, uuid) TO authenticated;

-- Students: campus-assigned staff can only read rows for assigned campuses.
DROP POLICY IF EXISTS "Staff can view students" ON public.students;
CREATE POLICY "Staff can view students" ON public.students
  FOR SELECT TO authenticated USING (
    (auth.uid() = user_id AND NOT login_disabled)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'faculty'::public.app_role) OR
        public.has_role(auth.uid(), 'teacher'::public.app_role) OR
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
        public.has_role(auth.uid(), 'data_entry'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
        public.has_role(auth.uid(), 'school_coordinator'::public.app_role)
      )
      AND public.user_can_access_record_campus(auth.uid(), students.campus_id)
    )
  );

-- Applications: scope staff reads through lead campus first, then application
-- course selection campus when the lead does not carry one.
DROP POLICY IF EXISTS "Staff view all applications" ON public.applications;
CREATE POLICY "Staff view all applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
        OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
        OR public.has_role(auth.uid(), 'counsellor'::public.app_role)
        OR public.has_role(auth.uid(), 'office_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'accountant'::public.app_role)
        OR public.has_role(auth.uid(), 'data_entry'::public.app_role)
        OR public.has_role(auth.uid(), 'office_assistant'::public.app_role)
        OR public.has_role(auth.uid(), 'school_coordinator'::public.app_role)
      )
      AND public.user_can_access_record_campus(
        auth.uid(),
        public.application_branch_campus_id(applications.lead_id, applications.course_selections)
      )
    )
  );

-- Finance read surfaces.
DROP POLICY IF EXISTS "Finance staff can view all ledger" ON public.fee_ledger;
DROP POLICY IF EXISTS "Office assistants view assigned branch ledger" ON public.fee_ledger;
CREATE POLICY "Finance staff can view all ledger" ON public.fee_ledger
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
        public.has_role(auth.uid(), 'school_coordinator'::public.app_role)
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = fee_ledger.student_id
          AND public.user_can_access_record_campus(auth.uid(), s.campus_id)
      )
    )
  );

DROP POLICY IF EXISTS "Finance staff can view ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Finance staff can view ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
        public.has_role(auth.uid(), 'school_coordinator'::public.app_role)
      )
      AND EXISTS (
        SELECT 1
        FROM public.fee_ledger fl
        JOIN public.students s ON s.id = fl.student_id
        WHERE fl.id = fee_ledger_payments.fee_ledger_id
          AND public.user_can_access_record_campus(auth.uid(), s.campus_id)
      )
    )
  );

DROP POLICY IF EXISTS "Staff can read lead_payments" ON public.lead_payments;
CREATE POLICY "Staff can read lead_payments" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
        public.has_role(auth.uid(), 'counsellor'::public.app_role) OR
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'data_entry'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
        public.has_role(auth.uid(), 'school_coordinator'::public.app_role)
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.id = lead_payments.lead_id
            AND public.user_can_access_record_campus(auth.uid(), l.campus_id)
        )
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = lead_payments.student_id
            AND public.user_can_access_record_campus(auth.uid(), s.campus_id)
        )
      )
    )
  );

-- SECURITY DEFINER concession request guard. Non-super-admins can request only;
-- decide_fee_concession remains super_admin-only in existing migrations.
CREATE OR REPLACE FUNCTION public.request_fee_concession(
  _student_id    uuid,
  _fee_ledger_id uuid,
  _type          text,
  _value         numeric,
  _reason        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile   uuid;
  v_id        uuid;
  v_total     numeric;
  v_paid      numeric;
  v_campus    uuid;
  v_existing  numeric;
  v_new       numeric;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'principal'::public.app_role) OR
    public.has_role(auth.uid(), 'accountant'::public.app_role) OR
    public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
    public.has_role(auth.uid(), 'school_coordinator'::public.app_role) OR
    public.has_role(auth.uid(), 'counsellor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorised to request a concession';
  END IF;

  IF _type NOT IN ('flat', 'percentage') THEN
    RAISE EXCEPTION 'Concession type must be flat or percentage';
  END IF;
  IF _value IS NULL OR _value <= 0 THEN
    RAISE EXCEPTION 'Concession value must be greater than zero';
  END IF;
  IF _type = 'percentage' AND _value > 100 THEN
    RAISE EXCEPTION 'Percentage concession cannot exceed 100';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT fl.total_amount, fl.paid_amount, s.campus_id
    INTO v_total, v_paid, v_campus
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
   WHERE fl.id = _fee_ledger_id
     AND fl.student_id = _student_id;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'Fee item does not belong to this student';
  END IF;
  IF NOT public.user_can_access_record_campus(auth.uid(), v_campus) THEN
    RAISE EXCEPTION 'Not authorised for this campus';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN c.type = 'flat'
                           THEN c.value
                           ELSE round(v_total * c.value / 100, 2) END), 0)
    INTO v_existing
    FROM public.concessions c
   WHERE c.fee_ledger_id = _fee_ledger_id
     AND c.status IN ('approved', 'pending_principal', 'pending_super_admin');

  v_new := CASE WHEN _type = 'flat' THEN _value ELSE round(v_total * _value / 100, 2) END;

  IF v_existing + v_new > GREATEST(v_total - v_paid, 0) THEN
    RAISE EXCEPTION 'Waivers on this head would exceed the payable amount: % already waived or pending, % remaining',
      v_existing, GREATEST(v_total - v_paid, 0);
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE user_id = auth.uid();

  INSERT INTO public.concessions
    (student_id, fee_ledger_id, type, value, reason, status, requested_by)
  VALUES
    (_student_id, _fee_ledger_id, _type, _value, btrim(_reason),
     'pending_super_admin', v_profile)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_fee_concession(uuid, uuid, text, numeric, text)
  TO authenticated, service_role;

-- Concession removal requests. Non-super-admin staff submit a note-backed
-- request; only super_admin approval removes the concession from the ledger.
ALTER TABLE public.concessions
  ADD COLUMN IF NOT EXISTS removal_requested_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS removal_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS removal_reason text,
  ADD COLUMN IF NOT EXISTS removal_decision_note text;

ALTER TABLE public.concession_audit
  DROP CONSTRAINT IF EXISTS concession_audit_action_check;
ALTER TABLE public.concession_audit
  ADD CONSTRAINT concession_audit_action_check
  CHECK (action IN ('edit', 'remove', 'remove_request', 'remove_reject'));

DROP POLICY IF EXISTS "finance reads concession audit" ON public.concession_audit;
CREATE POLICY "finance reads concession audit" ON public.concession_audit
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'accountant'::public.app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'principal'::public.app_role) OR
    public.has_role(auth.uid(), 'counsellor'::public.app_role) OR
    public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'office_assistant'::public.app_role)
  );

CREATE OR REPLACE FUNCTION public.remove_fee_concession(
  _id     uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            record;
  v_total      numeric;
  v_old_amount numeric;
  v_role       text;
  v_campus     uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can remove a concession. Submit a removal request instead.';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A removal note is required';
  END IF;

  SELECT * INTO c FROM public.concessions WHERE id = _id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Concession not found'; END IF;
  IF c.status = 'rejected' THEN RETURN; END IF;

  SELECT fl.total_amount, s.campus_id
    INTO v_total, v_campus
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
   WHERE fl.id = c.fee_ledger_id;
  IF NOT public.user_can_access_record_campus(auth.uid(), v_campus) THEN
    RAISE EXCEPTION 'Not authorised for this campus';
  END IF;

  v_old_amount := public.concession_effective_amount(c.type, c.value, v_total);
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;

  UPDATE public.concessions
     SET status                 = 'rejected',
         decision_note          = btrim(_reason),
         removal_decision_note  = btrim(_reason)
   WHERE id = _id;

  INSERT INTO public.concession_audit
    (concession_id, student_id, fee_ledger_id, action,
     old_type, old_value, new_type, new_value, old_amount, new_amount,
     reason, actor_user_id, actor_role)
  VALUES
    (_id, c.student_id, c.fee_ledger_id, 'remove',
     c.type, c.value, NULL, NULL, v_old_amount, 0,
     btrim(_reason), auth.uid(), v_role);

  PERFORM public.sync_fee_ledger_concessions(c.student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_fee_concession(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_remove_fee_concession(
  _id     uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            record;
  v_total      numeric;
  v_old_amount numeric;
  v_role       text;
  v_profile    uuid;
  v_campus     uuid;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A removal note is required';
  END IF;

  IF public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    PERFORM public.remove_fee_concession(_id, _reason);
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN (
        'principal'::public.app_role,
        'office_assistant'::public.app_role,
        'office_admin'::public.app_role,
        'counsellor'::public.app_role
      )
  ) THEN
    RAISE EXCEPTION 'Not authorised to request concession removal';
  END IF;

  SELECT * INTO c FROM public.concessions WHERE id = _id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Concession not found'; END IF;
  IF c.status = 'rejected' THEN
    RAISE EXCEPTION 'This concession has already been removed';
  END IF;
  IF c.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved concessions can be sent for removal';
  END IF;
  IF c.removal_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'This concession already has a pending removal request';
  END IF;

  SELECT fl.total_amount, s.campus_id
    INTO v_total, v_campus
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
   WHERE fl.id = c.fee_ledger_id;
  IF NOT public.user_can_access_record_campus(auth.uid(), v_campus) THEN
    RAISE EXCEPTION 'Not authorised for this campus';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE user_id = auth.uid();
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  v_old_amount := public.concession_effective_amount(c.type, c.value, v_total);

  UPDATE public.concessions
     SET removal_requested_by = v_profile,
         removal_requested_at = now(),
         removal_reason       = btrim(_reason),
         removal_decision_note = NULL
   WHERE id = _id;

  INSERT INTO public.concession_audit
    (concession_id, student_id, fee_ledger_id, action,
     old_type, old_value, new_type, new_value, old_amount, new_amount,
     reason, actor_user_id, actor_role)
  VALUES
    (_id, c.student_id, c.fee_ledger_id, 'remove_request',
     c.type, c.value, c.type, c.value, v_old_amount, v_old_amount,
     btrim(_reason), auth.uid(), v_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_remove_fee_concession(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decide_fee_concession_removal(
  _id      uuid,
  _approve boolean,
  _note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            record;
  v_total      numeric;
  v_old_amount numeric;
  v_note       text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can decide concession removal';
  END IF;

  SELECT * INTO c FROM public.concessions WHERE id = _id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Concession not found'; END IF;
  IF c.status = 'rejected' THEN RETURN; END IF;
  IF c.removal_requested_at IS NULL THEN
    RAISE EXCEPTION 'No removal request is pending for this concession';
  END IF;

  SELECT total_amount INTO v_total FROM public.fee_ledger WHERE id = c.fee_ledger_id;
  v_old_amount := public.concession_effective_amount(c.type, c.value, v_total);
  v_note := NULLIF(btrim(COALESCE(_note, c.removal_reason, '')), '');

  IF _approve THEN
    UPDATE public.concessions
       SET status                = 'rejected',
           decision_note         = v_note,
           removal_decision_note = v_note
     WHERE id = _id;

    INSERT INTO public.concession_audit
      (concession_id, student_id, fee_ledger_id, action,
       old_type, old_value, new_type, new_value, old_amount, new_amount,
       reason, actor_user_id, actor_role)
    VALUES
      (_id, c.student_id, c.fee_ledger_id, 'remove',
       c.type, c.value, NULL, NULL, v_old_amount, 0,
       v_note, auth.uid(), 'super_admin');

    PERFORM public.sync_fee_ledger_concessions(c.student_id);
  ELSE
    UPDATE public.concessions
       SET removal_requested_by  = NULL,
           removal_requested_at  = NULL,
           removal_reason        = NULL,
           removal_decision_note = v_note
     WHERE id = _id;

    INSERT INTO public.concession_audit
      (concession_id, student_id, fee_ledger_id, action,
       old_type, old_value, new_type, new_value, old_amount, new_amount,
       reason, actor_user_id, actor_role)
    VALUES
      (_id, c.student_id, c.fee_ledger_id, 'remove_reject',
       c.type, c.value, c.type, c.value, v_old_amount, v_old_amount,
       v_note, auth.uid(), 'super_admin');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_fee_concession_removal(uuid, boolean, text)
  TO authenticated, service_role;

CREATE OR REPLACE VIEW public.pending_approvals AS
 SELECT 'concession'::text AS kind, (c.id)::text AS id, c.status,
    (c.student_id)::text AS subject_id, s.name AS subject_name,
    c.type AS detail_type, c.value AS detail_value, c.reason,
    (c.requested_by)::text AS requested_by_id, c.created_at,
    CASE WHEN (c.status = 'pending_principal'::text) THEN 'principal'::text
         WHEN (c.status = 'pending_super_admin'::text) THEN 'super_admin'::text
         ELSE NULL::text END AS pending_role
   FROM (concessions c LEFT JOIN students s ON ((s.id = c.student_id)))
  WHERE (c.status = ANY (ARRAY['pending_principal'::text, 'pending_super_admin'::text]))
    AND NOT public.student_hidden_from_staff_queues(c.student_id)
UNION ALL
 SELECT 'concession_removal'::text, (c.id)::text, 'pending_super_admin'::text,
    (c.student_id)::text, s.name,
    'remove'::text, c.value, c.removal_reason,
    (c.removal_requested_by)::text, c.removal_requested_at, 'super_admin'::text
   FROM (concessions c LEFT JOIN students s ON ((s.id = c.student_id)))
  WHERE c.removal_requested_at IS NOT NULL
    AND c.status = 'approved'::text
    AND NOT public.student_hidden_from_staff_queues(c.student_id)
UNION ALL
 SELECT 'offer_letter'::text, (ol.id)::text, ol.approval_status, (ol.lead_id)::text, l.name,
    'flat'::text, ol.net_fee, NULL::text, (ol.issued_by)::text, ol.created_at, 'principal'::text
   FROM (offer_letters ol LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (ol.approval_status = 'pending_principal'::text)
    AND NOT public.lead_hidden_from_staff_queues(ol.lead_id)
UNION ALL
 SELECT 'offer_edit'::text, (er.id)::text, er.status, (ol.lead_id)::text, l.name,
    'edit_request'::text, NULL::numeric, er.reason, (er.requested_by)::text, er.created_at, 'super_admin'::text
   FROM ((offer_letter_edit_requests er
     JOIN offer_letters ol ON ((ol.id = er.offer_letter_id)))
     LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (er.status = 'pending'::text)
    AND NOT public.lead_hidden_from_staff_queues(ol.lead_id)
UNION ALL
 SELECT 'student_contact_change'::text, (scr.id)::text, scr.status, (scr.student_id)::text, s.name,
    scr.field_name, NULL::numeric, scr.reason, (scr.requested_by)::text, scr.created_at, 'principal'::text
   FROM (student_contact_change_requests scr LEFT JOIN students s ON ((s.id = scr.student_id)))
  WHERE (scr.status = 'pending'::text)
    AND NOT public.student_hidden_from_staff_queues(scr.student_id)
UNION ALL
 SELECT 'lead_deletion'::text, (ldr.id)::text, 'pending_admin'::text, (ldr.lead_id)::text, l.name,
    ldr.reason, NULL::numeric, ldr.custom_message, (ldr.requested_by)::text, ldr.created_at, 'super_admin'::text
   FROM (lead_deletion_requests ldr LEFT JOIN leads l ON ((l.id = ldr.lead_id)))
  WHERE (ldr.status = 'pending'::text)
UNION ALL
 SELECT 'pending_an'::text, (l.id)::text, 'pending'::text, (s.id)::text, s.name,
    'pending_an'::text, NULL::numeric, NULL::text, NULL::text, s.updated_at, 'principal'::text
   FROM (students s JOIN leads l ON ((l.id = s.lead_id)))
  WHERE s.pre_admission_no IS NOT NULL
    AND s.admission_no IS NULL
    AND NOT public.lead_hidden_from_staff_queues(l.id)
    AND NOT public.lead_docs_ready_for_admission(l.id)
    AND (public.lead_fee_status(l.id)->>'twenty_five_complete')::boolean;

ALTER VIEW public.pending_approvals SET (security_invoker = true);
GRANT SELECT ON public.pending_approvals TO authenticated;

-- Final concession edit/remove policy: removing an approved concession does not
-- require super-admin approval, but always requires a note and always audits.
CREATE OR REPLACE FUNCTION public.edit_fee_concession(
  _id    uuid,
  _type  text,
  _value numeric,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            record;
  v_total      numeric;
  v_old_amount numeric;
  v_new_amount numeric;
  v_super      boolean;
  v_role       text;
  v_campus     uuid;
BEGIN
  v_super := public.has_role(auth.uid(), 'super_admin'::public.app_role);
  IF NOT (
    v_super OR
    public.has_role(auth.uid(), 'accountant'::public.app_role) OR
    public.has_role(auth.uid(), 'principal'::public.app_role) OR
    public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
    public.has_role(auth.uid(), 'counsellor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorised to edit a concession';
  END IF;

  IF _type NOT IN ('flat', 'percentage') THEN
    RAISE EXCEPTION 'Concession type must be flat or percentage';
  END IF;
  IF _value IS NULL OR _value <= 0 THEN
    RAISE EXCEPTION 'Concession value must be greater than zero (use remove instead)';
  END IF;
  IF _type = 'percentage' AND _value > 100 THEN
    RAISE EXCEPTION 'Percentage concession cannot exceed 100';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO c FROM public.concessions WHERE id = _id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Concession not found'; END IF;
  IF c.status = 'rejected' THEN
    RAISE EXCEPTION 'This concession has already been removed';
  END IF;
  IF c.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved concessions can be edited';
  END IF;

  SELECT fl.total_amount, s.campus_id
    INTO v_total, v_campus
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
   WHERE fl.id = c.fee_ledger_id;
  IF NOT public.user_can_access_record_campus(auth.uid(), v_campus) THEN
    RAISE EXCEPTION 'Not authorised for this campus';
  END IF;

  v_old_amount := public.concession_effective_amount(c.type, c.value, v_total);
  v_new_amount := public.concession_effective_amount(_type, _value, v_total);

  IF v_new_amount >= v_old_amount AND NOT v_super THEN
    RAISE EXCEPTION 'Only a super admin can increase or keep the same waiver. Enter a lower value to reduce it.';
  END IF;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;

  UPDATE public.concessions
     SET type   = _type,
         value  = _value,
         reason = btrim(_reason)
   WHERE id = _id;

  INSERT INTO public.concession_audit
    (concession_id, student_id, fee_ledger_id, action,
     old_type, old_value, new_type, new_value, old_amount, new_amount,
     reason, actor_user_id, actor_role)
  VALUES
    (_id, c.student_id, c.fee_ledger_id, 'edit',
     c.type, c.value, _type, _value, v_old_amount, v_new_amount,
     btrim(_reason), auth.uid(), v_role);

  PERFORM public.sync_fee_ledger_concessions(c.student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_fee_concession(uuid, text, numeric, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_fee_concession(
  _id     uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            record;
  v_total      numeric;
  v_old_amount numeric;
  v_role       text;
  v_campus     uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'principal'::public.app_role) OR
    public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
    public.has_role(auth.uid(), 'counsellor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorised to remove a concession';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A removal note is required';
  END IF;

  SELECT * INTO c FROM public.concessions WHERE id = _id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Concession not found'; END IF;
  IF c.status = 'rejected' THEN RETURN; END IF;
  IF c.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved concessions can be removed';
  END IF;

  SELECT fl.total_amount, s.campus_id
    INTO v_total, v_campus
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
   WHERE fl.id = c.fee_ledger_id;
  IF NOT public.user_can_access_record_campus(auth.uid(), v_campus) THEN
    RAISE EXCEPTION 'Not authorised for this campus';
  END IF;

  v_old_amount := public.concession_effective_amount(c.type, c.value, v_total);
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;

  UPDATE public.concessions
     SET status                = 'rejected',
         decision_note         = btrim(_reason),
         removal_requested_by  = NULL,
         removal_requested_at  = NULL,
         removal_reason        = NULL,
         removal_decision_note = btrim(_reason)
   WHERE id = _id;

  INSERT INTO public.concession_audit
    (concession_id, student_id, fee_ledger_id, action,
     old_type, old_value, new_type, new_value, old_amount, new_amount,
     reason, actor_user_id, actor_role)
  VALUES
    (_id, c.student_id, c.fee_ledger_id, 'remove',
     c.type, c.value, NULL, NULL, v_old_amount, 0,
     btrim(_reason), auth.uid(), v_role);

  PERFORM public.sync_fee_ledger_concessions(c.student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_fee_concession(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_remove_fee_concession(
  _id     uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.remove_fee_concession(_id, _reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_remove_fee_concession(uuid, text)
  TO authenticated, service_role;

-- No pending-approval queue entry is needed for concession removals now.
CREATE OR REPLACE VIEW public.pending_approvals AS
 SELECT 'concession'::text AS kind, (c.id)::text AS id, c.status,
    (c.student_id)::text AS subject_id, s.name AS subject_name,
    c.type AS detail_type, c.value AS detail_value, c.reason,
    (c.requested_by)::text AS requested_by_id, c.created_at,
    CASE WHEN (c.status = 'pending_principal'::text) THEN 'principal'::text
         WHEN (c.status = 'pending_super_admin'::text) THEN 'super_admin'::text
         ELSE NULL::text END AS pending_role
   FROM (concessions c LEFT JOIN students s ON ((s.id = c.student_id)))
  WHERE (c.status = ANY (ARRAY['pending_principal'::text, 'pending_super_admin'::text]))
    AND NOT public.student_hidden_from_staff_queues(c.student_id)
UNION ALL
 SELECT 'offer_letter'::text, (ol.id)::text, ol.approval_status, (ol.lead_id)::text, l.name,
    'flat'::text, ol.net_fee, NULL::text, (ol.issued_by)::text, ol.created_at, 'principal'::text
   FROM (offer_letters ol LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (ol.approval_status = 'pending_principal'::text)
    AND NOT public.lead_hidden_from_staff_queues(ol.lead_id)
UNION ALL
 SELECT 'offer_edit'::text, (er.id)::text, er.status, (ol.lead_id)::text, l.name,
    'edit_request'::text, NULL::numeric, er.reason, (er.requested_by)::text, er.created_at, 'super_admin'::text
   FROM ((offer_letter_edit_requests er
     JOIN offer_letters ol ON ((ol.id = er.offer_letter_id)))
     LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (er.status = 'pending'::text)
    AND NOT public.lead_hidden_from_staff_queues(ol.lead_id)
UNION ALL
 SELECT 'student_contact_change'::text, (scr.id)::text, scr.status, (scr.student_id)::text, s.name,
    scr.field_name, NULL::numeric, scr.reason, (scr.requested_by)::text, scr.created_at, 'principal'::text
   FROM (student_contact_change_requests scr LEFT JOIN students s ON ((s.id = scr.student_id)))
  WHERE (scr.status = 'pending'::text)
    AND NOT public.student_hidden_from_staff_queues(scr.student_id)
UNION ALL
 SELECT 'lead_deletion'::text, (ldr.id)::text, 'pending_admin'::text, (ldr.lead_id)::text, l.name,
    ldr.reason, NULL::numeric, ldr.custom_message, (ldr.requested_by)::text, ldr.created_at, 'super_admin'::text
   FROM (lead_deletion_requests ldr LEFT JOIN leads l ON ((l.id = ldr.lead_id)))
  WHERE (ldr.status = 'pending'::text)
UNION ALL
 SELECT 'pending_an'::text, (l.id)::text, 'pending'::text, (s.id)::text, s.name,
    'pending_an'::text, NULL::numeric, NULL::text, NULL::text, s.updated_at, 'principal'::text
   FROM (students s JOIN leads l ON ((l.id = s.lead_id)))
  WHERE s.pre_admission_no IS NOT NULL
    AND s.admission_no IS NULL
    AND NOT public.lead_hidden_from_staff_queues(l.id)
    AND NOT public.lead_docs_ready_for_admission(l.id)
    AND (public.lead_fee_status(l.id)->>'twenty_five_complete')::boolean;

ALTER VIEW public.pending_approvals SET (security_invoker = true);
GRANT SELECT ON public.pending_approvals TO authenticated;

NOTIFY pgrst, 'reload schema';
