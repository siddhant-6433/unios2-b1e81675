-- ====================================================================
-- Cashier desk: ad-hoc fee heads, head-tagged receipts, and a concession
-- request/approve pair that goes through the canonical ledger sync.
--
-- 1. optional_fee_heads — a catalog of on-demand charges (Sports, Transfer
--    Certificate, Arrear Fee...) that a super_admin enables for everyone or
--    scopes to a campus / course / session / single student. The amount is
--    FIXED here; the cashier can never set or edit it.
-- 2. lead_payments.fee_code_id — every offline receipt now carries a
--    structured head instead of stuffing it into notes.
-- 3. request_fee_concession / decide_fee_concession — replaces the frontend
--    writing fee_ledger.concession directly. That direct write was
--    DESTRUCTIVE: it assigned rather than summed, so approving a manual
--    concession silently wiped any offer-waiver concession already mapped
--    onto the same ledger row. Everything now funnels through the
--    idempotent sync_fee_ledger_concessions().
-- 4. finance_summary — the Finance header cards were totalling a
--    client-side .limit(200) slice of fee_ledger, not the real book.
-- ====================================================================

-- ────────── who may take money at the counter ─────────────────────────
CREATE OR REPLACE FUNCTION public.can_collect_fee(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user, 'super_admin')
      OR public.has_role(_user, 'accountant');
$$;

GRANT EXECUTE ON FUNCTION public.can_collect_fee(uuid) TO authenticated, service_role;

-- ────────── 1. ad-hoc fee head catalog ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.optional_fee_heads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_code_id  uuid NOT NULL REFERENCES public.fee_codes(id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  -- Scope: every non-null column is AND-ed. All null = available to everyone.
  -- leads carry campus_id + course_id but no session_id, so a session-scoped
  -- head simply never matches a pre-admission lead.
  campus_id    uuid REFERENCES public.campuses(id) ON DELETE CASCADE,
  course_id    uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  session_id   uuid REFERENCES public.admission_sessions(id) ON DELETE CASCADE,
  student_id   uuid REFERENCES public.students(id) ON DELETE CASCADE,
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_optional_fee_heads_active
  ON public.optional_fee_heads (is_active, fee_code_id);

ALTER TABLE public.optional_fee_heads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read optional fee heads" ON public.optional_fee_heads;
CREATE POLICY "Staff can read optional fee heads" ON public.optional_fee_heads
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- Write is super_admin (or an explicit fee_structure:manage grant) only —
-- can_manage_fee_structure was already narrowed to exactly that.
DROP POLICY IF EXISTS "Super admin manages optional fee heads" ON public.optional_fee_heads;
CREATE POLICY "Super admin manages optional fee heads" ON public.optional_fee_heads
  FOR ALL TO authenticated
  USING (public.can_manage_fee_structure(auth.uid()))
  WITH CHECK (public.can_manage_fee_structure(auth.uid()));

GRANT SELECT ON public.optional_fee_heads TO authenticated;
GRANT ALL    ON public.optional_fee_heads TO service_role;

-- ────────── 2. head-tagged receipts ───────────────────────────────────
ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS fee_code_id uuid REFERENCES public.fee_codes(id);

COMMENT ON COLUMN public.lead_payments.fee_code_id IS
  'Fee head this receipt was collected against. Set by the cashier desk for '
  'ad-hoc charges (and any offline receipt); NULL for gateway/legacy rows.';

-- ────────── 3. which heads apply to this person ───────────────────────
CREATE OR REPLACE FUNCTION public.available_fee_charges(
  _student_id uuid DEFAULT NULL,
  _lead_id    uuid DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  fee_code_id uuid,
  code        text,
  name        text,
  amount      numeric,
  notes       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_campus  uuid;
  v_course  uuid;
  v_session uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF _student_id IS NOT NULL THEN
    SELECT s.campus_id, s.course_id, s.session_id
      INTO v_campus, v_course, v_session
      FROM public.students s WHERE s.id = _student_id;
  ELSIF _lead_id IS NOT NULL THEN
    -- leads have no session; session-scoped heads won't match, by design.
    SELECT l.campus_id, l.course_id, NULL::uuid
      INTO v_campus, v_course, v_session
      FROM public.leads l WHERE l.id = _lead_id;
  ELSE
    RETURN;
  END IF;

  RETURN QUERY
    SELECT ofh.id, ofh.fee_code_id, fc.code, fc.name, ofh.amount, ofh.notes
      FROM public.optional_fee_heads ofh
      JOIN public.fee_codes fc ON fc.id = ofh.fee_code_id
     WHERE ofh.is_active
       AND (ofh.campus_id  IS NULL OR ofh.campus_id  = v_campus)
       AND (ofh.course_id  IS NULL OR ofh.course_id  = v_course)
       AND (ofh.session_id IS NULL OR ofh.session_id = v_session)
       AND (ofh.student_id IS NULL OR ofh.student_id = _student_id)
     ORDER BY fc.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.available_fee_charges(uuid, uuid) TO authenticated, service_role;

-- ────────── 4. levy an ad-hoc charge onto a student ledger ────────────
-- Amount comes from the catalog row, never from the caller.
CREATE OR REPLACE FUNCTION public.levy_fee_charge(
  _student_id uuid,
  _head_id    uuid,
  _due_date   date DEFAULT NULL,
  _note       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_head   record;
  v_exists uuid;
  v_id     uuid;
BEGIN
  IF NOT public.can_collect_fee(auth.uid()) THEN
    RAISE EXCEPTION 'Only an accountant or super admin can levy a charge';
  END IF;

  SELECT ofh.*, fc.code INTO v_head
    FROM public.optional_fee_heads ofh
    JOIN public.fee_codes fc ON fc.id = ofh.fee_code_id
   WHERE ofh.id = _head_id AND ofh.is_active;
  IF v_head IS NULL THEN
    RAISE EXCEPTION 'Fee head not found or inactive';
  END IF;

  -- Scope re-check server-side: the client list is a convenience, not a gate.
  IF NOT EXISTS (
    SELECT 1 FROM public.available_fee_charges(_student_id, NULL) a WHERE a.id = _head_id
  ) THEN
    RAISE EXCEPTION 'This fee head is not enabled for this student';
  END IF;

  -- Don't stack a second unpaid copy of the same charge.
  SELECT fl.id INTO v_exists
    FROM public.fee_ledger fl
   WHERE fl.student_id = _student_id
     AND fl.fee_code_id = v_head.fee_code_id
     AND fl.term = 'adhoc'
     AND fl.balance > 0
   LIMIT 1;
  IF v_exists IS NOT NULL THEN
    RAISE EXCEPTION 'An unpaid % charge already exists for this student', v_head.code;
  END IF;

  INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
  VALUES (_student_id, v_head.fee_code_id, 'adhoc', v_head.amount,
          COALESCE(_due_date, CURRENT_DATE), 'due')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.levy_fee_charge(uuid, uuid, date, text) TO authenticated, service_role;

-- ────────── 5. concession request → super_admin decision ──────────────
ALTER TABLE public.concessions
  ADD COLUMN IF NOT EXISTS decision_note text;

-- Cashier/counsellor raises the request. Never touches fee_ledger.
CREATE OR REPLACE FUNCTION public.request_fee_concession(
  _student_id    uuid,
  _fee_ledger_id uuid,
  _type          text,
  _value         numeric,
  _reason        text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_id      uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised';
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
  IF NOT EXISTS (
    SELECT 1 FROM public.fee_ledger
     WHERE id = _fee_ledger_id AND student_id = _student_id
  ) THEN
    RAISE EXCEPTION 'Fee item does not belong to this student';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE user_id = auth.uid();

  -- Straight to super_admin: the principal step is not part of the cashier flow.
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

-- Only a super_admin decides. Approval routes the ledger write through the
-- canonical, idempotent sync instead of assigning fee_ledger.concession.
CREATE OR REPLACE FUNCTION public.decide_fee_concession(
  _id      uuid,
  _approve boolean,
  _note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_student uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can decide a concession';
  END IF;

  SELECT student_id INTO v_student FROM public.concessions WHERE id = _id;
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Concession not found';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE user_id = auth.uid();

  UPDATE public.concessions
     SET status                  = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         approved_by             = CASE WHEN _approve THEN v_profile ELSE approved_by END,
         approved_by_principal   = COALESCE(approved_by_principal, auth.uid()),
         principal_decision_at   = COALESCE(principal_decision_at, now()),
         approved_by_super_admin = auth.uid(),
         super_admin_decision_at = now(),
         decision_note           = NULLIF(btrim(COALESCE(_note, '')), '')
   WHERE id = _id;

  -- Recompute-from-source, so an approved offer waiver on the same ledger
  -- row survives. Runs on reject too: it removes the concession cleanly if
  -- the row had previously been approved.
  PERFORM public.sync_fee_ledger_concessions(v_student);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_fee_concession(uuid, boolean, text)
  TO authenticated, service_role;

-- ────────── 6. server-side finance totals ─────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_summary(_campus_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_fee',     COALESCE(SUM(fl.total_amount), 0),
    'collected',     COALESCE(SUM(fl.paid_amount), 0),
    'concession',    COALESCE(SUM(fl.concession), 0),
    'due',           COALESCE(SUM(fl.balance), 0),
    'overdue',       COALESCE(SUM(fl.balance) FILTER (WHERE fl.status = 'overdue'), 0),
    'paid_items',    COUNT(*) FILTER (WHERE fl.status = 'paid'),
    'total_items',   COUNT(*)
  )
  FROM public.fee_ledger fl
  JOIN public.students s ON s.id = fl.student_id
  WHERE (
      public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'campus_admin')
      OR public.has_role(auth.uid(), 'principal')
      OR public.has_role(auth.uid(), 'accountant')
    )
    AND (_campus_ids IS NULL OR s.campus_id = ANY (_campus_ids));
$$;

GRANT EXECUTE ON FUNCTION public.finance_summary(uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
