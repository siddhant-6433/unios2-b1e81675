-- HR Executive: permissions, the document approval workflow (copy of the PGDM
-- certificate gate), interview scheduling, and recruitment RLS. Runs AFTER the
-- enum value 'hr_executive' is committed (its own migration).

-- ════════════════════════════════════════════════════════════════════════
-- 1. Permissions + grants
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (module, action, description) VALUES
  ('hr', 'documents_generate', 'Generate HR documents (offer letters, employee letters) for approval'),
  ('hr', 'interviews_edit',    'Schedule and manage candidate interviews')
ON CONFLICT (module, action) DO NOTHING;

-- HR Executive grant set: recruitment + document generation + WhatsApp + self-service.
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'hr_executive'::public.app_role, p.id
FROM public.permissions p
WHERE (p.module || ':' || p.action) IN (
  'dashboard:view', 'hr:view', 'hr:self', 'hr:recruitment_edit',
  'hr:documents_generate', 'hr:interviews_edit',
  'whatsapp:view', 'whatsapp:send', 'documents:view'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- The two new perms also go to the roles that already run recruitment.
INSERT INTO public.role_permissions (role, permission_id)
SELECT r.role, p.id
FROM (VALUES ('admission_head'::public.app_role), ('campus_admin'::public.app_role)) AS r(role)
CROSS JOIN public.permissions p
WHERE p.module = 'hr' AND p.action IN ('documents_generate', 'interviews_edit')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 2. hr_letters → approvable, applicant-or-employee document
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.hr_letters
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS job_applicant_id uuid REFERENCES public.job_applicants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS submitted_by     uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS submitted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by      uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS issued_at        timestamptz;

-- Existing letters were generated + printed directly; keep them visible/printable.
UPDATE public.hr_letters SET status = 'issued' WHERE status = 'draft' AND created_at < now();

-- A letter targets exactly one of: an employee OR a job applicant.
ALTER TABLE public.hr_letters ALTER COLUMN employee_profile_id DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.hr_letters ADD CONSTRAINT hr_letters_one_target_chk
    CHECK ((employee_profile_id IS NOT NULL)::int + (job_applicant_id IS NOT NULL)::int = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.hr_letters ADD CONSTRAINT hr_letters_status_chk
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'issued'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS hr_letters_pending_idx ON public.hr_letters (status) WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS hr_letters_applicant_idx ON public.hr_letters (job_applicant_id) WHERE job_applicant_id IS NOT NULL;

-- ── Append-only audit (mirror pgdm_certificate_audit) ──────────────────────
CREATE TABLE IF NOT EXISTS public.hr_document_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id  uuid NOT NULL REFERENCES public.hr_letters(id) ON DELETE CASCADE,
  action     text NOT NULL, -- generated | submitted | approved | rejected | issued
  actor_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_document_audit_letter ON public.hr_document_audit (letter_id, created_at DESC);

ALTER TABLE public.hr_document_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hr_document_audit_read" ON public.hr_document_audit;
CREATE POLICY "hr_document_audit_read" ON public.hr_document_audit
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'hr:documents_generate')
    OR public.has_permission(auth.uid(), 'hr:employees_edit')
  );
GRANT SELECT ON public.hr_document_audit TO authenticated;

-- No INSERT/UPDATE/DELETE policy: written only via this DEFINER helper (append-only).
CREATE OR REPLACE FUNCTION public.log_hr_document_action(_letter_id uuid, _action text, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  SELECT COALESCE(NULLIF(display_name, ''), email) INTO v_name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.hr_document_audit (letter_id, action, actor_id, actor_name, details)
  VALUES (_letter_id, _action, auth.uid(), v_name, COALESCE(_details, '{}'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_hr_document_action(uuid, text, jsonb) TO authenticated, service_role;

-- Notify every super_admin that a document awaits approval (deep-link to /inbox).
CREATE OR REPLACE FUNCTION public.notify_super_admins_hr_document(_letter_id uuid, _title text, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT ur.user_id, 'hr_document_pending', _title, _body, '/inbox'
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'::public.app_role;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notify_super_admins_hr_document(uuid, text, text) TO authenticated, service_role;

-- ── generate_hr_letter (employee letters) — now routes through approval ────
CREATE OR REPLACE FUNCTION public.generate_hr_letter(_employee_profile_id uuid, _template_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.hr_letter_templates; e public.employee_profiles;
  ent text; sal numeric; txt text; sub text; v_id uuid; v_super boolean;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:documents_generate')
          OR public.has_permission(auth.uid(), 'hr:employees_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  v_super := public.has_role(auth.uid(), 'super_admin'::public.app_role);

  SELECT * INTO t FROM public.hr_letter_templates WHERE code = _template_code AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Letter template % not found', _template_code; END IF;
  SELECT * INTO e FROM public.employee_profiles WHERE id = _employee_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  SELECT le.legal_name INTO ent FROM public.legal_entities le WHERE le.id = e.legal_entity_id;
  SELECT s.monthly_gross INTO sal FROM public.employee_salaries s
    WHERE s.employee_profile_id = e.id AND s.effective_to IS NULL
    ORDER BY s.effective_from DESC LIMIT 1;

  txt := t.body; sub := COALESCE(t.subject, t.name);
  txt := replace(txt, '{{employee_name}}',   COALESCE(e.display_name, ''));
  txt := replace(txt, '{{employee_number}}', COALESCE(e.employee_number, ''));
  txt := replace(txt, '{{designation}}',     COALESCE(e.job_title, ''));
  txt := replace(txt, '{{date_of_joining}}', COALESCE(to_char(e.date_of_joining, 'DD Mon YYYY'), ''));
  txt := replace(txt, '{{date_of_exit}}',    COALESCE(to_char(e.date_of_exit, 'DD Mon YYYY'), ''));
  txt := replace(txt, '{{work_location}}',   COALESCE(e.work_location, ''));
  txt := replace(txt, '{{department}}',      COALESCE(e.hr_department, ''));
  txt := replace(txt, '{{legal_entity}}',    COALESCE(ent, ''));
  txt := replace(txt, '{{monthly_gross}}',   COALESCE(to_char(sal, 'FM99,99,999'), ''));
  txt := replace(txt, '{{today}}',           to_char(CURRENT_DATE, 'DD Mon YYYY'));
  sub := replace(sub, '{{employee_name}}', COALESCE(e.display_name, ''));

  INSERT INTO public.hr_letters (
    employee_profile_id, template_id, letter_code, letter_name, subject, body,
    reference_no, issued_by, status, submitted_by, submitted_at,
    approved_by, approved_at
  ) VALUES (
    e.id, t.id, t.code, t.name, sub, txt,
    'HR/' || to_char(CURRENT_DATE, 'YYYY') || '/' || COALESCE(e.employee_number, left(e.id::text, 6)),
    auth.uid(),
    CASE WHEN v_super THEN 'approved' ELSE 'pending_approval' END,
    auth.uid(), now(),
    CASE WHEN v_super THEN auth.uid() ELSE NULL END,
    CASE WHEN v_super THEN now() ELSE NULL END
  ) RETURNING id INTO v_id;

  PERFORM public.log_hr_document_action(v_id, 'generated', jsonb_build_object('template', t.code));
  IF NOT v_super THEN
    PERFORM public.notify_super_admins_hr_document(
      v_id, 'HR document pending approval',
      t.name || ' for ' || COALESCE(e.display_name, 'employee') || ' awaits approval.');
    PERFORM public.log_hr_document_action(v_id, 'submitted', '{}'::jsonb);
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_hr_letter(uuid, text) TO authenticated;

-- ── generate_hr_offer_letter (applicant offer letters) ─────────────────────
CREATE OR REPLACE FUNCTION public.generate_hr_offer_letter(_job_applicant_id uuid, _details jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.hr_letter_templates; a public.job_applicants;
  txt text; sub text; v_id uuid; v_super boolean;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:documents_generate')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  v_super := public.has_role(auth.uid(), 'super_admin'::public.app_role);

  SELECT * INTO t FROM public.hr_letter_templates WHERE code = 'offer' AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer letter template not found'; END IF;
  SELECT * INTO a FROM public.job_applicants WHERE id = _job_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;

  txt := t.body; sub := COALESCE(t.subject, t.name);
  txt := replace(txt, '{{applicant_name}}', COALESCE(a.name, ''));
  txt := replace(txt, '{{offered_role}}',   COALESCE(_details->>'offered_role', a.desired_role, ''));
  txt := replace(txt, '{{offered_ctc}}',    COALESCE(_details->>'offered_ctc', ''));
  txt := replace(txt, '{{joining_date}}',   COALESCE(_details->>'joining_date', ''));
  txt := replace(txt, '{{legal_entity}}',   COALESCE(_details->>'legal_entity', ''));
  txt := replace(txt, '{{today}}',          to_char(CURRENT_DATE, 'DD Mon YYYY'));
  sub := replace(sub, '{{applicant_name}}', COALESCE(a.name, ''));

  INSERT INTO public.hr_letters (
    job_applicant_id, template_id, letter_code, letter_name, subject, body,
    reference_no, issued_by, status, submitted_by, submitted_at, approved_by, approved_at
  ) VALUES (
    a.id, t.id, t.code, t.name, sub, txt,
    'HR/OFR/' || to_char(CURRENT_DATE, 'YYYY') || '/' || left(a.id::text, 6),
    auth.uid(),
    CASE WHEN v_super THEN 'approved' ELSE 'pending_approval' END,
    auth.uid(), now(),
    CASE WHEN v_super THEN auth.uid() ELSE NULL END,
    CASE WHEN v_super THEN now() ELSE NULL END
  ) RETURNING id INTO v_id;

  PERFORM public.log_hr_document_action(v_id, 'generated', jsonb_build_object('applicant', a.name));
  IF NOT v_super THEN
    PERFORM public.notify_super_admins_hr_document(
      v_id, 'Offer letter pending approval',
      'Offer letter for ' || COALESCE(a.name, 'applicant') || ' awaits approval.');
    PERFORM public.log_hr_document_action(v_id, 'submitted', '{}'::jsonb);
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_hr_offer_letter(uuid, jsonb) TO authenticated;

-- ── approve / reject (super_admin only) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_hr_document(_letter_id uuid, _notes text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.hr_letters%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only superadmin can approve HR documents';
  END IF;
  SELECT * INTO v FROM public.hr_letters WHERE id = _letter_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF v.status <> 'pending_approval' THEN RAISE EXCEPTION 'Document is not pending approval'; END IF;

  UPDATE public.hr_letters
     SET status = 'approved', approved_by = auth.uid(), approved_at = now(), rejection_reason = NULL
   WHERE id = _letter_id;

  IF v.submitted_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v.submitted_by, 'hr_document_approved', 'HR document approved',
            v.letter_name || ' is approved and can now be issued.', '/hr');
  END IF;
  PERFORM public.log_hr_document_action(_letter_id, 'approved', jsonb_build_object('notes', _notes));
  RETURN 'approved';
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_hr_document(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_hr_document(_letter_id uuid, _reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.hr_letters%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only superadmin can reject HR documents';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT * INTO v FROM public.hr_letters WHERE id = _letter_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF v.status <> 'pending_approval' THEN RAISE EXCEPTION 'Document is not pending approval'; END IF;

  UPDATE public.hr_letters SET status = 'rejected', rejection_reason = _reason WHERE id = _letter_id;

  IF v.submitted_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v.submitted_by, 'hr_document_rejected', 'HR document rejected',
            v.letter_name || ' was rejected: ' || _reason, '/hr');
  END IF;
  PERFORM public.log_hr_document_action(_letter_id, 'rejected', jsonb_build_object('reason', _reason));
  RETURN 'rejected';
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_hr_document(uuid, text) TO authenticated;

-- ── issue (the send gate): blocked until approved ──────────────────────────
CREATE OR REPLACE FUNCTION public.issue_hr_document(_letter_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.hr_letters%ROWTYPE;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:documents_generate')
          OR public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO v FROM public.hr_letters WHERE id = _letter_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF v.status NOT IN ('approved', 'issued') THEN
    RAISE EXCEPTION 'Document must be approved before it can be issued';
  END IF;
  IF v.status = 'approved' THEN
    UPDATE public.hr_letters SET status = 'issued', issued_at = now() WHERE id = _letter_id;
    PERFORM public.log_hr_document_action(_letter_id, 'issued', '{}'::jsonb);
  END IF;
  RETURN v.body;
END;
$$;
GRANT EXECUTE ON FUNCTION public.issue_hr_document(uuid) TO authenticated;

-- ── Offer letter template ──────────────────────────────────────────────────
INSERT INTO public.hr_letter_templates (code, name, subject, body) VALUES
  ('offer', 'Offer Letter', 'Offer of Employment — {{applicant_name}}',
   E'Dear {{applicant_name}},\n\n'
   'We are pleased to offer you the position of {{offered_role}} at {{legal_entity}}.\n\n'
   'Your annual CTC will be Rs. {{offered_ctc}}. Your expected date of joining is '
   '{{joining_date}}.\n\n'
   'This offer is subject to verification of your documents and references.\n\n'
   'We look forward to welcoming you to the team.\n\n'
   'Date: {{today}}')
ON CONFLICT (code) DO NOTHING;

-- ── hr_letters RLS: let hr:documents_generate manage too ───────────────────
DROP POLICY IF EXISTS "HR reads letters" ON public.hr_letters;
CREATE POLICY "HR reads letters"
  ON public.hr_letters FOR ALL TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:documents_generate'))
  )
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:documents_generate'))
  );

-- ════════════════════════════════════════════════════════════════════════
-- 3. Interviews (greenfield)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.interviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_applicant_id uuid NOT NULL REFERENCES public.job_applicants(id) ON DELETE CASCADE,
  scheduled_at     timestamptz NOT NULL,
  mode             text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'phone', 'video')),
  location         text,
  meeting_link     text,
  interviewer_id   uuid REFERENCES auth.users(id),
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interviews_applicant ON public.interviews (job_applicant_id, scheduled_at DESC);

ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Recruitment manages interviews" ON public.interviews;
CREATE POLICY "Recruitment manages interviews"
  ON public.interviews FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_permission(auth.uid(), 'hr:interviews_edit')
    OR public.has_permission(auth.uid(), 'hr:recruitment_edit')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_permission(auth.uid(), 'hr:interviews_edit')
    OR public.has_permission(auth.uid(), 'hr:recruitment_edit')
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interviews TO authenticated;
GRANT ALL ON public.interviews TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 4. job_applicants: let recruitment-permissioned staff (hr_executive) manage
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Admins manage job_applicants" ON public.job_applicants;
CREATE POLICY "Admins manage job_applicants"
  ON public.job_applicants FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
    OR public.has_permission(auth.uid(), 'hr:recruitment_edit')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
    OR public.has_permission(auth.uid(), 'hr:recruitment_edit')
  );

-- ════════════════════════════════════════════════════════════════════════
-- 5. notifications type CHECK: add the HR document types (widen, don't shrink)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'lead_assigned','sla_warning','lead_reclaimed','followup_due','followup_overdue',
  'visit_confirmation_due','visit_followup_due','lead_transferred','deletion_request',
  'whatsapp_message','whatsapp_sla_warning','whatsapp_sla_breach','approval_pending',
  'approval_decided','template_status_update','tat_defaults_report','post_visit_nudge',
  'score_penalty','lead_bucket_backlog','feedback_received','campaign_completed',
  'student_service_assigned','student_service_unassigned','pgdm_certificate_pending',
  'pgdm_certificate_approved','pgdm_diploma_ready','general','visit_due','missed_call',
  'callback_requested','notice_published','gatepass_update','assignment_due',
  'substitution_assigned','leave_decision','hostel_alert','approval_request',
  'payment_receipt','finance_audit_anomaly','partner_referral_outcome','an_pending_docs',
  'hr_document_pending','hr_document_approved','hr_document_rejected'
]::text[]));
