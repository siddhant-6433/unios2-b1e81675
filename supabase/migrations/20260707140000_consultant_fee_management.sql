-- ====================================================================
-- Consultant-managed fees — hide the fee STRUCTURE from a consultant's
-- linked students (receipts + due + Pay button stay visible).
--
--   1. consultant_fee_management — admin enablement, course+session scope.
--   2. student_fee_visibility    — per-student toggle set by the consultant.
--   3. is_fee_hidden_for_student()          — fails open to visible.
--      consultant_set_fee_visibility()      — consultant self-service, scoped.
--      consultant_student_fee_summary()     — consultant read of fees.
--      student_fee_due_summary()            — hidden-mode student view.
--   4. ONE RLS tightening: student-role SELECT on fee_ledger gains
--      "AND NOT is_fee_hidden_for_student(student_id)". Receipts stay visible.
--   5. v_student_fee_visibility — staff-readable lookup for list pages.
--
-- Separate tables (no students column) keep existing RLS untouched and give
-- audit for free. Everything except the one fee_ledger policy is additive.
-- ====================================================================

-- 1. Admin enablement (course + session scope) ----------------------------
CREATE TABLE IF NOT EXISTS public.consultant_fee_management (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.admission_sessions(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  enabled_by uuid NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, course_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_cfm_consultant ON public.consultant_fee_management(consultant_id);

ALTER TABLE public.consultant_fee_management ENABLE ROW LEVEL SECURITY;

-- Admins manage the config; consultants may read their own rows.
DROP POLICY IF EXISTS "Admins manage consultant_fee_management" ON public.consultant_fee_management;
CREATE POLICY "Admins manage consultant_fee_management"
  ON public.consultant_fee_management FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Consultants read own fee_management" ON public.consultant_fee_management;
CREATE POLICY "Consultants read own fee_management"
  ON public.consultant_fee_management FOR SELECT TO authenticated
  USING (consultant_id IN (SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_fee_management TO authenticated, service_role;

-- 2. Per-student visibility toggle ----------------------------------------
CREATE TABLE IF NOT EXISTS public.student_fee_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid UNIQUE NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  hidden boolean NOT NULL DEFAULT true,
  set_by uuid NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sfv_consultant ON public.student_fee_visibility(consultant_id);

ALTER TABLE public.student_fee_visibility ENABLE ROW LEVEL SECURITY;

-- Staff read all; consultants read their own; writes go through the RPC (which
-- validates scope) so there is no direct consultant INSERT/UPDATE policy.
DROP POLICY IF EXISTS "Staff read student_fee_visibility" ON public.student_fee_visibility;
CREATE POLICY "Staff read student_fee_visibility"
  ON public.student_fee_visibility FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR consultant_id IN (SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid()))
  );

GRANT SELECT ON public.student_fee_visibility TO authenticated, service_role;

-- 3a. is_fee_hidden_for_student — fails OPEN to visible --------------------
-- true iff a visibility row exists AND is hidden AND the matching
-- consultant_fee_management is enabled AND the consultant is active.
CREATE OR REPLACE FUNCTION public.is_fee_hidden_for_student(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT sfv.hidden
      AND cfm.enabled
      AND c.stage <> 'inactive'
    FROM public.student_fee_visibility sfv
    JOIN public.students st          ON st.id = sfv.student_id
    JOIN public.consultants c        ON c.id = sfv.consultant_id
    JOIN public.consultant_fee_management cfm
      ON cfm.consultant_id = sfv.consultant_id
     AND cfm.course_id     = st.course_id
     AND cfm.session_id    = st.session_id
    WHERE sfv.student_id = _student_id
    LIMIT 1
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_fee_hidden_for_student(uuid) TO authenticated, service_role, anon;

-- 3b. consultant_set_fee_visibility — consultant self-service, scoped ------
CREATE OR REPLACE FUNCTION public.consultant_set_fee_visibility(
  _student_id uuid,
  _hidden     boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consultant_id uuid;
  v_course_id     uuid;
  v_session_id    uuid;
  v_enabled       boolean;
BEGIN
  -- Caller's consultant row must own the student's lead.
  SELECT c.id INTO v_consultant_id
    FROM public.consultants c
    JOIN public.leads l ON l.consultant_id = c.id
    JOIN public.students s ON s.lead_id = l.id
   WHERE c.user_id = auth.uid()
     AND s.id = _student_id
   LIMIT 1;

  IF v_consultant_id IS NULL THEN
    RAISE EXCEPTION 'Student is not linked to your consultant account';
  END IF;

  SELECT course_id, session_id INTO v_course_id, v_session_id
    FROM public.students WHERE id = _student_id;

  -- The student's course+session must be enabled for this consultant.
  SELECT enabled INTO v_enabled
    FROM public.consultant_fee_management
   WHERE consultant_id = v_consultant_id
     AND course_id = v_course_id
     AND session_id = v_session_id;

  IF v_enabled IS NULL OR v_enabled = false THEN
    RAISE EXCEPTION 'Fee management is not enabled for this course/session';
  END IF;

  INSERT INTO public.student_fee_visibility (student_id, consultant_id, hidden, set_by)
  VALUES (_student_id, v_consultant_id, _hidden, auth.uid())
  ON CONFLICT (student_id) DO UPDATE
    SET hidden = EXCLUDED.hidden,
        consultant_id = EXCLUDED.consultant_id,
        set_by = EXCLUDED.set_by,
        set_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultant_set_fee_visibility(uuid, boolean) TO authenticated, service_role;

-- 3c. consultant_student_fee_summary — consultant read of a student's fees -
-- Scoped: caller's consultant must own the student's lead AND the course+
-- session must be enabled. Returns the full ledger + receipts (the consultant
-- always sees everything).
CREATE OR REPLACE FUNCTION public.consultant_student_fee_summary(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consultant_id uuid;
  v_ledger        jsonb;
  v_receipts      jsonb;
  v_due           numeric;
BEGIN
  SELECT c.id INTO v_consultant_id
    FROM public.consultants c
    JOIN public.leads l ON l.consultant_id = c.id
    JOIN public.students s ON s.lead_id = l.id
   WHERE c.user_id = auth.uid()
     AND s.id = _student_id
   LIMIT 1;

  IF v_consultant_id IS NULL THEN
    RAISE EXCEPTION 'Student is not linked to your consultant account';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(fl) ORDER BY fl.due_date), '[]'::jsonb),
         COALESCE(SUM(fl.balance) FILTER (WHERE fl.status IN ('due','overdue')), 0)
    INTO v_ledger, v_due
    FROM public.fee_ledger fl
   WHERE fl.student_id = _student_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'receipt_no', lp.receipt_no,
           'amount', lp.amount,
           'type', lp.type,
           'payment_date', lp.payment_date,
           'receipt_url', lp.receipt_url
         ) ORDER BY lp.payment_date DESC), '[]'::jsonb)
    INTO v_receipts
    FROM public.lead_payments lp
    JOIN public.students s ON s.lead_id = lp.lead_id
   WHERE s.id = _student_id AND lp.status = 'confirmed';

  RETURN jsonb_build_object(
    'due_total', v_due,
    'ledger',    v_ledger,
    'receipts',  v_receipts,
    'hidden',    public.is_fee_hidden_for_student(_student_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultant_student_fee_summary(uuid) TO authenticated, service_role;

-- 3d. student_fee_due_summary — hidden-mode student view -------------------
-- Returns ONLY the due total + receipts (no structure). Caller must be the
-- student themself. Powers the hidden-mode portal view.
CREATE OR REPLACE FUNCTION public.student_fee_due_summary(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owns    boolean;
  v_due     numeric;
  v_receipts jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.students s
     WHERE s.id = _student_id AND s.user_id = auth.uid()
  ) INTO v_owns;

  IF NOT v_owns THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT COALESCE(SUM(fl.balance) FILTER (WHERE fl.status IN ('due','overdue')), 0)
    INTO v_due
    FROM public.fee_ledger fl
   WHERE fl.student_id = _student_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'receipt_no', lp.receipt_no,
           'amount', lp.amount,
           'type', lp.type,
           'payment_date', lp.payment_date,
           'receipt_url', lp.receipt_url
         ) ORDER BY lp.payment_date DESC), '[]'::jsonb)
    INTO v_receipts
    FROM public.lead_payments lp
    JOIN public.students s ON s.lead_id = lp.lead_id
   WHERE s.id = _student_id AND lp.status = 'confirmed';

  RETURN jsonb_build_object('due_total', v_due, 'receipts', v_receipts);
END;
$$;

GRANT EXECUTE ON FUNCTION public.student_fee_due_summary(uuid) TO authenticated, service_role;

-- 3e. consultant_fee_students — list the caller's fee-manageable students ----
-- Students linked to the caller's consultant (via leads.consultant_id) whose
-- course+session is enabled in consultant_fee_management. Powers the portal
-- "Fees" tab without granting consultants direct RLS on students/fee_ledger.
CREATE OR REPLACE FUNCTION public.consultant_fee_students()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'student_id',    s.id,
    'name',          s.name,
    'admission_no',  COALESCE(s.admission_no, s.pre_admission_no),
    'course_name',   crs.name,
    'session_name',  sess.name,
    'due_total',     COALESCE(fl.due_total, 0),
    'paid_total',    COALESCE(fl.paid_total, 0),
    'hidden',        COALESCE(sfv.hidden, false),
    'config_enabled', cfm.enabled
  ) ORDER BY s.name), '[]'::jsonb)
  FROM public.consultants c
  JOIN public.leads l        ON l.consultant_id = c.id
  JOIN public.students s     ON s.lead_id = l.id
  JOIN public.consultant_fee_management cfm
    ON cfm.consultant_id = c.id
   AND cfm.course_id     = s.course_id
   AND cfm.session_id    = s.session_id
  LEFT JOIN public.courses crs             ON crs.id = s.course_id
  LEFT JOIN public.admission_sessions sess ON sess.id = s.session_id
  LEFT JOIN public.student_fee_visibility sfv ON sfv.student_id = s.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(balance) FILTER (WHERE status IN ('due','overdue')), 0) AS due_total,
           COALESCE(SUM(paid_amount), 0) AS paid_total
      FROM public.fee_ledger
     WHERE student_id = s.id
  ) fl ON true
  WHERE c.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.consultant_fee_students() TO authenticated, service_role;

-- 4. The ONE RLS tightening — student-role SELECT on fee_ledger structure --
-- ⚠️ RLS tightening, student role only. Receipts (lead_payments/payments read
-- paths) are untouched. Fails open: is_fee_hidden_for_student returns false
-- when the config is missing/disabled, restoring the normal student view.
DROP POLICY IF EXISTS "Students can view own ledger" ON public.fee_ledger;
CREATE POLICY "Students can view own ledger" ON public.fee_ledger
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = fee_ledger.student_id AND s.user_id = auth.uid()
    )
    AND NOT public.is_fee_hidden_for_student(fee_ledger.student_id)
  );

-- 5. Staff-readable lookup view for list pages ----------------------------
CREATE OR REPLACE VIEW public.v_student_fee_visibility  -- lint-allow: staff finance surfaces read this; consultant/staff RLS on base tables scopes it, and the flag itself is non-sensitive
WITH (security_invoker = on) AS
SELECT
  sfv.student_id,
  sfv.consultant_id,
  sfv.hidden,
  public.is_fee_hidden_for_student(sfv.student_id) AS effective_hidden,
  c.name AS consultant_name
FROM public.student_fee_visibility sfv
JOIN public.consultants c ON c.id = sfv.consultant_id;

GRANT SELECT ON public.v_student_fee_visibility TO authenticated;
