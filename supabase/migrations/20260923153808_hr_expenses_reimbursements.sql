-- HR Expenses & Reimbursements (new pillar).
--
-- Employees raise claims against a category; HR approves/rejects; approved
-- claims are reimbursed through a payroll cycle (or marked reimbursed
-- manually). Mirrors the letters workflow: an append-only audit log, an inbox
-- view for approvers, and in-app notifications on every decision.

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  -- 'reimbursement' = money already spent by the employee
  -- 'advance'       = money paid up front, settled later
  kind            text NOT NULL DEFAULT 'reimbursement'
                    CHECK (kind IN ('reimbursement', 'advance')),
  requires_receipt boolean NOT NULL DEFAULT true,
  max_amount      numeric(14,2),
  is_active       boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expense_categories_active_idx
  ON public.expense_categories (is_active, display_order);

CREATE TABLE IF NOT EXISTS public.expense_claims (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  submitted_by        uuid REFERENCES auth.users(id),
  category_id         uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  title               text NOT NULL,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  currency            text NOT NULL DEFAULT 'INR',
  expense_date        date NOT NULL,
  description         text,
  receipt_url         text,
  status              text NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'cancelled')),
  decided_by          uuid REFERENCES auth.users(id),
  decided_at          timestamptz,
  decision_note       text,
  reimbursed_at       timestamptz,
  payroll_cycle_id    uuid REFERENCES public.payroll_cycles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expense_claims_employee_idx
  ON public.expense_claims (employee_profile_id, status, expense_date DESC);
CREATE INDEX IF NOT EXISTS expense_claims_pending_idx
  ON public.expense_claims (status, created_at DESC) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS expense_claims_category_idx
  ON public.expense_claims (category_id);
CREATE INDEX IF NOT EXISTS expense_claims_cycle_idx
  ON public.expense_claims (payroll_cycle_id) WHERE payroll_cycle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.expense_claim_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id   uuid NOT NULL REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  action     text NOT NULL,
  actor_id   uuid REFERENCES auth.users(id),
  actor_name text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expense_claim_audit_claim_idx
  ON public.expense_claim_audit (claim_id, created_at DESC);

-- ── Seed categories ─────────────────────────────────────────────────────────

INSERT INTO public.expense_categories (code, name, kind, display_order) VALUES
  ('TRAVEL',      'Travel',              'reimbursement',  10),
  ('LOCAL_CONV',  'Local Conveyance',    'reimbursement',  20),
  ('MEALS',       'Meals & Food',        'reimbursement',  30),
  ('STAY',        'Accommodation',       'reimbursement',  40),
  ('INTERNET',    'Internet & Phone',    'reimbursement',  50),
  ('MEDICAL',     'Medical',             'reimbursement',  60),
  ('TRAINING',    'Training & Courses',  'reimbursement',  70),
  ('SUPPLIES',    'Office Supplies',     'reimbursement',  80),
  ('CLIENT',      'Client Entertainment','reimbursement',  90),
  ('FUEL',        'Fuel',                'reimbursement', 100),
  ('OTHER',       'Other',               'reimbursement', 999)
ON CONFLICT (code) DO NOTHING;

-- ── Permissions ─────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, action, description) VALUES
  ('hr', 'expenses_approve', 'Approve or reject employee expense claims'),
  ('hr', 'expenses_manage',  'Manage expense categories and settings')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE
  v_approve uuid;
  v_manage  uuid;
  r         app_role;
BEGIN
  SELECT id INTO v_approve FROM public.permissions WHERE module = 'hr' AND action = 'expenses_approve';
  SELECT id INTO v_manage  FROM public.permissions WHERE module = 'hr' AND action = 'expenses_manage';

  FOREACH r IN ARRAY ARRAY['super_admin','campus_admin','principal','hr_executive']::app_role[] LOOP
    INSERT INTO public.role_permissions (role, permission_id) VALUES (r, v_approve) ON CONFLICT DO NOTHING;
  END LOOP;

  FOREACH r IN ARRAY ARRAY['super_admin','campus_admin','hr_executive']::app_role[] LOOP
    INSERT INTO public.role_permissions (role, permission_id) VALUES (r, v_manage) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_claim_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read expense categories" ON public.expense_categories;
CREATE POLICY "Staff read expense categories"
  ON public.expense_categories FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "HR manages expense categories" ON public.expense_categories;
CREATE POLICY "HR manages expense categories"
  ON public.expense_categories FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:expenses_manage')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:expenses_manage')));

-- Employees: read + create + edit their own, while it is still in flight.
DROP POLICY IF EXISTS "Employees read own expense claims" ON public.expense_claims;
CREATE POLICY "Employees read own expense claims"
  ON public.expense_claims FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.employee_profiles e
             WHERE e.id = expense_claims.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees create own expense claims" ON public.expense_claims;
CREATE POLICY "Employees create own expense claims"
  ON public.expense_claims FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND status IN ('draft', 'submitted')
    AND EXISTS (SELECT 1 FROM public.employee_profiles e
                 WHERE e.id = expense_claims.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees edit own in-flight claims" ON public.expense_claims;
CREATE POLICY "Employees edit own in-flight claims"
  ON public.expense_claims FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.employee_profiles e
             WHERE e.id = expense_claims.employee_profile_id AND e.user_id = auth.uid())
    AND status IN ('draft', 'submitted')
  )
  WITH CHECK (status IN ('draft', 'submitted', 'cancelled'));

DROP POLICY IF EXISTS "Employees delete own draft claims" ON public.expense_claims;
CREATE POLICY "Employees delete own draft claims"
  ON public.expense_claims FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.employee_profiles e
             WHERE e.id = expense_claims.employee_profile_id AND e.user_id = auth.uid())
    AND status IN ('draft', 'cancelled')
  );

-- Approvers: read and action everything.
DROP POLICY IF EXISTS "HR reads expense claims" ON public.expense_claims;
CREATE POLICY "HR reads expense claims"
  ON public.expense_claims FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
  );

DROP POLICY IF EXISTS "HR updates expense claims" ON public.expense_claims;
CREATE POLICY "HR updates expense claims"
  ON public.expense_claims FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:expenses_approve')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:expenses_approve')));

DROP POLICY IF EXISTS "HR reads expense audit" ON public.expense_claim_audit;
CREATE POLICY "HR reads expense audit"
  ON public.expense_claim_audit FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_claims TO authenticated;
GRANT SELECT ON public.expense_claim_audit TO authenticated;
GRANT ALL ON public.expense_categories, public.expense_claims, public.expense_claim_audit TO service_role;

-- ── Triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_expense_claims_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_expense_claims_touch ON public.expense_claims;
CREATE TRIGGER trg_expense_claims_touch
  BEFORE UPDATE ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.tg_expense_claims_touch();

-- Append-only audit written from the database so a claim's history cannot be
-- edited away by the workflows.
CREATE OR REPLACE FUNCTION public.log_expense_claim_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_name text;
BEGIN
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.expense_claim_audit (claim_id, action, actor_id, actor_name, details)
    VALUES (NEW.id, 'created', auth.uid(), v_name,
            jsonb_build_object('amount', NEW.amount, 'status', NEW.status));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.expense_claim_audit (claim_id, action, actor_id, actor_name, details)
    VALUES (NEW.id, 'status:' || NEW.status, auth.uid(), v_name,
            jsonb_build_object('from', OLD.status, 'to', NEW.status, 'note', NEW.decision_note));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_claim_audit ON public.expense_claims;
CREATE TRIGGER trg_expense_claim_audit
  AFTER INSERT OR UPDATE ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.log_expense_claim_change();

-- ── RPCs ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decide_expense_claim(
  _claim_id uuid, _approve boolean, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.expense_claims;
  v_uid uuid;
  v_status text := CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:expenses_approve')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO c FROM public.expense_claims WHERE id = _claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense claim not found'; END IF;
  IF c.status <> 'submitted' THEN RAISE EXCEPTION 'Claim is already %', c.status; END IF;

  UPDATE public.expense_claims
     SET status = v_status, decided_by = auth.uid(), decided_at = now(), decision_note = _note
   WHERE id = _claim_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = c.employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      v_uid,
      'expense_decided',
      CASE WHEN _approve THEN 'Expense claim approved' ELSE 'Expense claim rejected' END,
      c.title || ' (₹' || to_char(c.amount, 'FM9999999990.00') || ') — ' ||
        COALESCE(_note, CASE WHEN _approve THEN 'approved' ELSE 'rejected' END),
      '/my-hr'
    );
  END IF;

  RETURN v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decide_expense_claim(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_expense_claim(uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_expense_reimbursed(
  _claim_id uuid, _payroll_cycle_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.expense_claims;
  v_uid uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_permission(auth.uid(), 'hr:expenses_approve')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO c FROM public.expense_claims WHERE id = _claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense claim not found'; END IF;
  IF c.status <> 'approved' THEN RAISE EXCEPTION 'Only approved claims can be reimbursed (current: %)', c.status; END IF;

  UPDATE public.expense_claims
     SET status = 'reimbursed', reimbursed_at = now(), payroll_cycle_id = _payroll_cycle_id
   WHERE id = _claim_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = c.employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'expense_paid', 'Expense reimbursed',
            c.title || ' (₹' || to_char(c.amount, 'FM9999999990.00') || ') has been reimbursed.',
            '/my-hr');
  END IF;

  RETURN 'reimbursed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_expense_reimbursed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_expense_reimbursed(uuid, uuid) TO authenticated, service_role;

-- Per-employee approved-but-unpaid reimbursement totals for a payroll period.
CREATE OR REPLACE FUNCTION public.expense_reimbursement_totals(
  _from date, _to date, _legal_entity_id uuid DEFAULT NULL
)
RETURNS TABLE (employee_profile_id uuid, employee_name text, total numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT c.employee_profile_id,
         COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))),
         sum(c.amount)
    FROM public.expense_claims c
    JOIN public.employee_profiles e ON e.id = c.employee_profile_id
   WHERE c.status = 'approved'
     AND c.expense_date BETWEEN _from AND _to
     AND (_legal_entity_id IS NULL OR e.legal_entity_id = _legal_entity_id)
   GROUP BY c.employee_profile_id, e.display_name, e.first_name, e.last_name
   ORDER BY 2;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expense_reimbursement_totals(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expense_reimbursement_totals(date, date, uuid) TO authenticated, service_role;

-- ── Inbox view ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.expense_claims_inbox AS
SELECT
  c.id,
  c.employee_profile_id,
  c.submitted_by,
  c.title,
  c.amount,
  c.currency,
  c.expense_date,
  c.description,
  c.receipt_url,
  c.status,
  c.decision_note,
  c.decided_at,
  c.reimbursed_at,
  c.payroll_cycle_id,
  c.created_at,
  c.updated_at,
  cat.name  AS category_name,
  cat.code  AS category_code,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  e.employee_number,
  e.user_id AS employee_user_id
FROM public.expense_claims c
LEFT JOIN public.expense_categories cat ON cat.id = c.category_id
LEFT JOIN public.employee_profiles e ON e.id = c.employee_profile_id;

ALTER VIEW public.expense_claims_inbox SET (security_invoker = true);
GRANT SELECT ON public.expense_claims_inbox TO authenticated, service_role;

COMMENT ON TABLE public.expense_claims IS
  'Employee expense/reimbursement claims. Status flow: draft → submitted → approved → reimbursed (or rejected/cancelled).';
