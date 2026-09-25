-- Expense claims: two-stage approval (reporting manager → super admin) with
-- mandatory proof, multi-file attachments, and a Zoho Books vendor bill — the
-- same shape as the video-portal approval + video-bill sync.
--
-- Status flow:
--   draft → submitted → pending_superadmin → approved → synced_to_zoho → reimbursed
--     │          │                │
--     │          ├── changes_requested (either level) → resubmit
--     │          └── rejected (either level, terminal)
--     └── cancelled (employee)

-- ── 1. Widen the status set and add stage / Zoho columns ────────────────────

ALTER TABLE public.expense_claims DROP CONSTRAINT IF EXISTS expense_claims_status_check;
ALTER TABLE public.expense_claims ADD CONSTRAINT expense_claims_status_check CHECK (status IN (
  'draft', 'submitted', 'changes_requested', 'pending_superadmin',
  'approved', 'synced_to_zoho', 'reimbursed', 'rejected', 'cancelled'
));

ALTER TABLE public.expense_claims
  ADD COLUMN IF NOT EXISTS submitted_at          timestamptz,
  ADD COLUMN IF NOT EXISTS l1_reviewer           uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS l1_status             text,
  ADD COLUMN IF NOT EXISTS l1_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS l1_note               text,
  ADD COLUMN IF NOT EXISTS l2_reviewer           uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS l2_status             text,
  ADD COLUMN IF NOT EXISTS l2_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS l2_note               text,
  ADD COLUMN IF NOT EXISTS correction_note       text,
  ADD COLUMN IF NOT EXISTS correction_requested_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS correction_at         timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason      text,
  ADD COLUMN IF NOT EXISTS rejected_by           uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at           timestamptz,
  ADD COLUMN IF NOT EXISTS zoho_bill_id          text,
  ADD COLUMN IF NOT EXISTS zoho_bill_number      text,
  ADD COLUMN IF NOT EXISTS zoho_payment_id       text,
  ADD COLUMN IF NOT EXISTS zoho_synced_at        timestamptz,
  ADD COLUMN IF NOT EXISTS zoho_sync_error       text,
  ADD COLUMN IF NOT EXISTS reimbursement_mode    text;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS zoho_vendor_id text;

CREATE INDEX IF NOT EXISTS expense_claims_l1_idx
  ON public.expense_claims (l1_reviewer, status) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS expense_claims_l2_idx
  ON public.expense_claims (status) WHERE status = 'pending_superadmin';

-- ── 2. Attachments (multiple proofs) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_claim_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    uuid NOT NULL REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  file_url    text NOT NULL,
  file_path   text,
  file_name   text,
  mime_type   text,
  file_size   integer,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expense_claim_attachments_claim_idx
  ON public.expense_claim_attachments (claim_id, uploaded_at);

ALTER TABLE public.expense_claim_attachments ENABLE ROW LEVEL SECURITY;

-- A reviewer or HR may read any attachment; an owner may read their own.
DROP POLICY IF EXISTS "Read claim attachments" ON public.expense_claim_attachments;
CREATE POLICY "Read claim attachments"
  ON public.expense_claim_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.expense_claims c WHERE c.id = claim_id
              AND (c.submitted_by = auth.uid() OR c.l1_reviewer = auth.uid()))
    OR (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
  );

-- Owner may add proofs only while the claim is still theirs to edit.
DROP POLICY IF EXISTS "Owner adds claim attachments" ON public.expense_claim_attachments;
CREATE POLICY "Owner adds claim attachments"
  ON public.expense_claim_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.expense_claims c
                 WHERE c.id = claim_id
                   AND c.submitted_by = auth.uid()
                   AND c.status IN ('draft', 'changes_requested'))
  );

DROP POLICY IF EXISTS "Owner removes claim attachments" ON public.expense_claim_attachments;
CREATE POLICY "Owner removes claim attachments"
  ON public.expense_claim_attachments FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.expense_claims c
             WHERE c.id = claim_id
               AND c.submitted_by = auth.uid()
               AND c.status IN ('draft', 'changes_requested'))
  );

GRANT SELECT, INSERT, DELETE ON public.expense_claim_attachments TO authenticated;
GRANT ALL ON public.expense_claim_attachments TO service_role;

-- ── 3. Mandatory proof on submit ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expense_proof_present(_claim_id uuid, _receipt_url text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(btrim(_receipt_url), '') <> ''
      OR EXISTS (SELECT 1 FROM public.expense_claim_attachments a WHERE a.claim_id = _claim_id);
$$;

CREATE OR REPLACE FUNCTION public.enforce_expense_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_required boolean;
BEGIN
  IF NEW.status <> 'submitted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN RETURN NEW; END IF;

  SELECT COALESCE(requires_receipt, true) INTO v_required
    FROM public.expense_categories WHERE id = NEW.category_id;
  IF v_required IS NULL THEN v_required := true; END IF;

  IF v_required AND NOT public.expense_proof_present(NEW.id, NEW.receipt_url) THEN
    RAISE EXCEPTION 'Attach a proof of expense (receipt/invoice) before submitting';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_expense_proof ON public.expense_claims;
CREATE TRIGGER trg_enforce_expense_proof
  BEFORE INSERT OR UPDATE ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_proof();

-- ── 4. Final-approval permission (super admin only) ─────────────────────────

INSERT INTO public.permissions (module, action, description)
VALUES ('hr', 'expenses_final_approve', 'Final (super admin) approval of expense claims')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE v_perm uuid;
BEGIN
  SELECT id INTO v_perm FROM public.permissions WHERE module = 'hr' AND action = 'expenses_final_approve';
  INSERT INTO public.role_permissions (role, permission_id)
  VALUES ('super_admin'::app_role, v_perm) ON CONFLICT DO NOTHING;
END $$;

-- ── 5. Audit stage column ───────────────────────────────────────────────────

ALTER TABLE public.expense_claim_audit ADD COLUMN IF NOT EXISTS stage text;

-- ── 6. RLS refresh for the new statuses ─────────────────────────────────────

DROP POLICY IF EXISTS "Employees edit own in-flight claims" ON public.expense_claims;
CREATE POLICY "Employees edit own in-flight claims"
  ON public.expense_claims FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.employee_profiles e
             WHERE e.id = expense_claims.employee_profile_id AND e.user_id = auth.uid())
    AND status IN ('draft', 'changes_requested')
  )
  WITH CHECK (status IN ('draft', 'changes_requested', 'cancelled'));

DROP POLICY IF EXISTS "Employees delete own draft claims" ON public.expense_claims;
CREATE POLICY "Employees delete own draft claims"
  ON public.expense_claims FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.employee_profiles e
             WHERE e.id = expense_claims.employee_profile_id AND e.user_id = auth.uid())
    AND status IN ('draft', 'cancelled')
  );

-- The reporting manager (L1) must be able to read the claims they must action,
-- even without hr:view.
DROP POLICY IF EXISTS "L1 reads assigned claims" ON public.expense_claims;
CREATE POLICY "L1 reads assigned claims"
  ON public.expense_claims FOR SELECT TO authenticated
  USING (l1_reviewer = auth.uid());

-- …and must be able to read their direct reports' profile rows, because the
-- expense inbox view (security_invoker) joins employee_profiles for the name.
DROP POLICY IF EXISTS "Managers read direct reports" ON public.employee_profiles;
CREATE POLICY "Managers read direct reports"
  ON public.employee_profiles FOR SELECT TO authenticated
  USING (reports_to = auth.uid());

DROP POLICY IF EXISTS "HR updates expense claims" ON public.expense_claims;
DROP POLICY IF EXISTS "Final approver updates expense claims" ON public.expense_claims;
CREATE POLICY "Final approver updates expense claims"
  ON public.expense_claims FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:expenses_final_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
  )
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:expenses_final_approve'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
  );

-- ── 7. Notification types ───────────────────────────────────────────────────

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'lead_assigned','sla_warning','lead_reclaimed','followup_due','followup_overdue',
  'visit_confirmation_due','visit_followup_due','lead_transferred','deletion_request',
  'whatsapp_message','whatsapp_sla_warning','whatsapp_sla_breach',
  'approval_pending','approval_decided','template_status_update','tat_defaults_report',
  'post_visit_nudge','score_penalty','lead_bucket_backlog','feedback_received',
  'campaign_completed','student_service_assigned','student_service_unassigned',
  'pgdm_certificate_pending','pgdm_certificate_approved','pgdm_diploma_ready',
  'general','visit_due','missed_call','callback_requested','notice_published',
  'gatepass_update','assignment_due','substitution_assigned','leave_decision',
  'hostel_alert','approval_request','payment_receipt','finance_audit_anomaly',
  'partner_referral_outcome','an_pending_docs',
  'hr_document_pending','hr_document_approved','hr_document_rejected',
  'finance_orphan_alert',
  'hr_document_expiring','hr_probation_due',
  'expense_submitted','expense_decided','expense_paid','payslip_ready',
  'announcement_published','interview_scheduled',
  'helpdesk_ticket','helpdesk_reply','performance_review','recognition',
  'expense_correction_requested','expense_pending_final','expense_synced','expense_sync_failed'
]));

-- ── 8. RPCs ─────────────────────────────────────────────────────────────────

-- Submit (or resubmit after a correction). Owner only.
CREATE OR REPLACE FUNCTION public.submit_expense_claim(_claim_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.expense_claims;
  v_manager uuid;
  v_l1 uuid;
  v_uid uuid;
BEGIN
  SELECT * INTO c FROM public.expense_claims WHERE id = _claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense claim not found'; END IF;
  IF c.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'Claim is already %', c.status;
  END IF;

  SELECT e.user_id, e.reports_to INTO v_uid, v_manager
    FROM public.employee_profiles e WHERE e.id = c.employee_profile_id;
  IF auth.uid() IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;

  -- Route to the reporting manager; the trigger already enforces proof.
  v_l1 := v_manager;

  UPDATE public.expense_claims
     SET status = 'submitted',
         submitted_at = now(),
         l1_reviewer = v_l1,
         l1_status = NULL, l1_note = NULL, l1_at = NULL,
         l2_status = NULL, l2_note = NULL, l2_at = NULL, l2_reviewer = NULL,
         correction_note = NULL, correction_requested_by = NULL, correction_at = NULL
   WHERE id = _claim_id;

  IF v_l1 IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_l1, 'expense_submitted', 'Expense claim to review',
            c.title || ' (₹' || to_char(c.amount, 'FM9999999990.00') || ') awaits your approval.', '/hr-expenses');
  ELSE
    -- No reporting manager configured: fall back to HR approvers.
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT ur.user_id, 'expense_submitted', 'Expense claim to review',
           c.title || ' (₹' || to_char(c.amount, 'FM9999999990.00') || ') awaits approval.', '/hr-expenses'
      FROM public.user_roles ur
     WHERE ur.role IN ('super_admin'::public.app_role, 'campus_admin'::public.app_role, 'principal'::public.app_role);
  END IF;

  RETURN 'submitted';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_expense_claim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_expense_claim(uuid) TO authenticated, service_role;

-- Internal: apply a review decision at either stage.
CREATE OR REPLACE FUNCTION public.fn_expense_review(
  _claim_id uuid, _stage text, _action text, _note text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.expense_claims;
  v_uid uuid;
  v_next text;
  v_require_note boolean := _action IN ('correction', 'reject');
BEGIN
  SELECT * INTO c FROM public.expense_claims WHERE id = _claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense claim not found'; END IF;

  IF _stage = 'l1' AND c.status <> 'submitted' THEN
    RAISE EXCEPTION 'Claim is not awaiting L1 review (currently %)', c.status;
  END IF;
  IF _stage = 'l2' AND c.status <> 'pending_superadmin' THEN
    RAISE EXCEPTION 'Claim is not awaiting final approval (currently %)', c.status;
  END IF;

  IF v_require_note AND COALESCE(btrim(_note), '') = '' THEN
    RAISE EXCEPTION 'A note is required to send for correction or reject';
  END IF;

  IF _action = 'approve' THEN
    v_next := CASE WHEN _stage = 'l1' THEN 'pending_superadmin' ELSE 'approved' END;
  ELSIF _action = 'correction' THEN
    v_next := 'changes_requested';
  ELSIF _action = 'reject' THEN
    v_next := 'rejected';
  ELSE
    RAISE EXCEPTION 'Unknown action %', _action;
  END IF;

  IF _stage = 'l1' THEN
    UPDATE public.expense_claims
       SET status = v_next, l1_status = _action, l1_reviewer = auth.uid(),
           l1_at = now(), l1_note = _note,
           correction_note = CASE WHEN _action = 'correction' THEN _note ELSE correction_note END,
           correction_requested_by = CASE WHEN _action = 'correction' THEN auth.uid() ELSE correction_requested_by END,
           correction_at = CASE WHEN _action = 'correction' THEN now() ELSE correction_at END,
           rejection_reason = CASE WHEN _action = 'reject' THEN _note ELSE rejection_reason END,
           rejected_by = CASE WHEN _action = 'reject' THEN auth.uid() ELSE rejected_by END,
           rejected_at = CASE WHEN _action = 'reject' THEN now() ELSE rejected_at END
     WHERE id = _claim_id;
  ELSE
    UPDATE public.expense_claims
       SET status = v_next, l2_status = _action, l2_reviewer = auth.uid(),
           l2_at = now(), l2_note = _note,
           correction_note = CASE WHEN _action = 'correction' THEN _note ELSE correction_note END,
           correction_requested_by = CASE WHEN _action = 'correction' THEN auth.uid() ELSE correction_requested_by END,
           correction_at = CASE WHEN _action = 'correction' THEN now() ELSE correction_at END,
           rejection_reason = CASE WHEN _action = 'reject' THEN _note ELSE rejection_reason END,
           rejected_by = CASE WHEN _action = 'reject' THEN auth.uid() ELSE rejected_by END,
           rejected_at = CASE WHEN _action = 'reject' THEN now() ELSE rejected_at END
     WHERE id = _claim_id;
  END IF;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = c.employee_profile_id;

  IF _action = 'approve' AND _stage = 'l1' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT ur.user_id, 'expense_pending_final', 'Expense claim needs final approval',
           c.title || ' (₹' || to_char(c.amount, 'FM9999999990.00') || ') approved by the manager.', '/hr-expenses'
      FROM public.user_roles ur WHERE ur.role = 'super_admin'::public.app_role;
  ELSIF _action = 'correction' THEN
    IF v_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_uid, 'expense_correction_requested', 'Expense claim sent for correction', COALESCE(_note, ''), '/my-hr');
    END IF;
  ELSIF _action = 'reject' THEN
    IF v_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_uid, 'expense_decided', 'Expense claim rejected', COALESCE(_note, ''), '/my-hr');
    END IF;
  ELSIF _action = 'approve' AND _stage = 'l2' THEN
    IF v_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_uid, 'expense_decided', 'Expense claim approved', 'Approved and being sent to accounts.', '/my-hr');
    END IF;
  END IF;

  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_expense_review(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.l1_decide_expense(_claim_id uuid, _action text, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE c public.expense_claims;
BEGIN
  SELECT * INTO c FROM public.expense_claims WHERE id = _claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense claim not found'; END IF;

  IF NOT (
    c.l1_reviewer = auth.uid()
    OR (SELECT public.has_permission(auth.uid(), 'hr:expenses_approve'))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN public.fn_expense_review(_claim_id, 'l1', _action, _note);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.l1_decide_expense(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.l1_decide_expense(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.l2_decide_expense(_claim_id uuid, _action text, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:expenses_final_approve')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN public.fn_expense_review(_claim_id, 'l2', _action, _note);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.l2_decide_expense(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.l2_decide_expense(uuid, text, text) TO authenticated, service_role;

-- Back-compat wrapper for the existing web panel: route by current status.
CREATE OR REPLACE FUNCTION public.decide_expense_claim(_claim_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE c public.expense_claims;
BEGIN
  SELECT * INTO c FROM public.expense_claims WHERE id = _claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense claim not found'; END IF;

  IF c.status = 'submitted' THEN
    RETURN public.l1_decide_expense(_claim_id, CASE WHEN _approve THEN 'approve' ELSE 'reject' END, _note);
  ELSIF c.status = 'pending_superadmin' THEN
    RETURN public.l2_decide_expense(_claim_id, CASE WHEN _approve THEN 'approve' ELSE 'reject' END, _note);
  END IF;
  RAISE EXCEPTION 'Claim is not awaiting review (currently %)', c.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decide_expense_claim(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_expense_claim(uuid, boolean, text) TO authenticated, service_role;

-- Edge function marks the Zoho sync result.
CREATE OR REPLACE FUNCTION public.mark_expense_synced(
  _claim_id uuid, _bill_id text, _bill_number text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_permission(auth.uid(), 'hr:expenses_final_approve')
              OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.expense_claims
     SET status = 'synced_to_zoho', zoho_bill_id = _bill_id, zoho_bill_number = _bill_number,
         zoho_synced_at = now(), zoho_sync_error = NULL
   WHERE id = _claim_id;
  RETURN 'synced_to_zoho';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_expense_synced(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_expense_synced(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_expense_sync_failed(_claim_id uuid, _error text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.expense_claims SET zoho_sync_error = _error WHERE id = _claim_id;
  RETURN 'failed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_expense_sync_failed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_expense_sync_failed(uuid, text) TO authenticated, service_role;

-- Reimbursement: both payroll and direct Zoho payment.
DROP FUNCTION IF EXISTS public.mark_expense_reimbursed(uuid, uuid);
CREATE OR REPLACE FUNCTION public.mark_expense_reimbursed(
  _claim_id uuid, _payroll_cycle_id uuid DEFAULT NULL, _mode text DEFAULT 'payroll'
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE c public.expense_claims; v_uid uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')
          OR public.has_permission(auth.uid(), 'hr:expenses_final_approve')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO c FROM public.expense_claims WHERE id = _claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense claim not found'; END IF;
  IF c.status NOT IN ('approved', 'synced_to_zoho') THEN
    RAISE EXCEPTION 'Only approved or synced claims can be reimbursed (current: %)', c.status;
  END IF;

  UPDATE public.expense_claims
     SET status = 'reimbursed', reimbursed_at = now(),
         payroll_cycle_id = COALESCE(_payroll_cycle_id, payroll_cycle_id),
         reimbursement_mode = _mode
   WHERE id = _claim_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = c.employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'expense_paid', 'Expense reimbursed',
            c.title || ' (₹' || to_char(c.amount, 'FM9999999990.00') || ') has been reimbursed.', '/my-hr');
  END IF;

  RETURN 'reimbursed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_expense_reimbursed(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_expense_reimbursed(uuid, uuid, text) TO authenticated, service_role;

-- ── 9. Stage-aware inbox view ───────────────────────────────────────────────

DROP VIEW IF EXISTS public.expense_claims_inbox;
CREATE VIEW public.expense_claims_inbox AS
SELECT
  c.id, c.employee_profile_id, c.submitted_by, c.title, c.amount, c.currency,
  c.expense_date, c.description, c.receipt_url, c.status, c.decision_note, c.decided_at,
  c.reimbursed_at, c.payroll_cycle_id, c.created_at, c.updated_at,
  c.submitted_at, c.l1_reviewer, c.l1_status, c.l1_at, c.l1_note,
  c.l2_reviewer, c.l2_status, c.l2_at, c.l2_note,
  c.correction_note, c.correction_at, c.rejection_reason, c.rejected_at,
  c.zoho_bill_id, c.zoho_bill_number, c.zoho_synced_at, c.zoho_sync_error,
  c.reimbursement_mode,
  cat.name AS category_name, cat.code AS category_code,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  e.employee_number, e.user_id AS employee_user_id,
  (SELECT count(*) FROM public.expense_claim_attachments a WHERE a.claim_id = c.id) AS proof_count
FROM public.expense_claims c
LEFT JOIN public.expense_categories cat ON cat.id = c.category_id
LEFT JOIN public.employee_profiles e ON e.id = c.employee_profile_id;

ALTER VIEW public.expense_claims_inbox SET (security_invoker = true);
GRANT SELECT ON public.expense_claims_inbox TO authenticated, service_role;
