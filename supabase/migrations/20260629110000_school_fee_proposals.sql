-- Approval-gated fee proposals for leads across school and non-school courses.

CREATE TABLE IF NOT EXISTS public.fee_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  created_by_role text,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending_super_admin', 'approved', 'rejected')),
  proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_children integer NOT NULL DEFAULT 0 CHECK (total_children >= 0),
  annual_total numeric(12,2) NOT NULL DEFAULT 0,
  annual_net_total numeric(12,2) NOT NULL DEFAULT 0,
  admission_payable_total numeric(12,2) NOT NULL DEFAULT 0,
  grayquest_principal_total numeric(12,2) NOT NULL DEFAULT 0,
  waiver_total numeric(12,2) NOT NULL DEFAULT 0,
  waiver_percent numeric(6,2) NOT NULL DEFAULT 0,
  whatsapp_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_proposals_lead
  ON public.fee_proposals (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_proposals_status
  ON public.fee_proposals (status)
  WHERE status = 'pending_super_admin';

COMMENT ON TABLE public.fee_proposals IS
  'Approval-gated fee proposals. Waivers up to 10% are auto-approved; larger waivers require super admin approval.';

ALTER TABLE public.fee_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admissions staff can view fee proposals" ON public.fee_proposals;
CREATE POLICY "Admissions staff can view fee proposals"
  ON public.fee_proposals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Admissions staff can create fee proposals" ON public.fee_proposals;
CREATE POLICY "Admissions staff can create fee proposals"
  ON public.fee_proposals FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Approvers can decide fee proposals" ON public.fee_proposals;
CREATE POLICY "Approvers can decide fee proposals"
  ON public.fee_proposals FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    created_by = auth.uid()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    created_by = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE ON public.fee_proposals TO authenticated;
GRANT ALL ON public.fee_proposals TO service_role;

CREATE OR REPLACE FUNCTION public.tg_fee_proposals_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NOT NULL THEN
      SELECT role::text INTO v_role
        FROM public.user_roles
       WHERE user_id = v_actor
       LIMIT 1;

      NEW.created_by := COALESCE(NEW.created_by, v_actor);
      NEW.created_by_role := COALESCE(NEW.created_by_role, v_role);
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fee_proposals_stamp ON public.fee_proposals;
CREATE TRIGGER fee_proposals_stamp
BEFORE INSERT OR UPDATE ON public.fee_proposals
FOR EACH ROW EXECUTE FUNCTION public.tg_fee_proposals_stamp();

CREATE OR REPLACE FUNCTION public.enforce_fee_proposal_approval_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.waiver_percent > 10
     AND NEW.status = 'approved'
     AND NOT public.has_role(v_actor, 'super_admin') THEN
    RAISE EXCEPTION 'Fee proposal waivers above 10%% require super admin approval';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fee_proposals_approval_limit ON public.fee_proposals;
CREATE TRIGGER fee_proposals_approval_limit
BEFORE INSERT OR UPDATE OF status, waiver_percent ON public.fee_proposals
FOR EACH ROW EXECUTE FUNCTION public.enforce_fee_proposal_approval_limit();

CREATE OR REPLACE FUNCTION public.notify_fee_proposal_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role app_role;
  v_title text;
  v_body text;
  v_recipient uuid;
BEGIN
  IF NEW.status <> 'pending_super_admin' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_role := 'super_admin'::app_role;
  v_title := 'Fee proposal approval pending';
  v_body := format(
    '%s student/program proposal. Admission payable: Rs. %s. Waiver: %s%%.',
    NEW.total_children,
    trim(to_char(NEW.admission_payable_total, 'FM99,99,99,990')),
    trim(to_char(NEW.waiver_percent, 'FM990D00'))
  );

  FOR v_recipient IN SELECT user_id FROM public.user_roles WHERE role = v_role LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      v_recipient,
      'approval_pending',
      v_title,
      v_body,
      '/admissions/' || NEW.lead_id::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_fee_proposal_pending ON public.fee_proposals;
CREATE TRIGGER trg_notify_fee_proposal_pending
AFTER INSERT OR UPDATE OF status ON public.fee_proposals
FOR EACH ROW EXECUTE FUNCTION public.notify_fee_proposal_pending();
