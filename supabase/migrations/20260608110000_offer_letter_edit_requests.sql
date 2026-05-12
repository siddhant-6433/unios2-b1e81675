-- Offer letter edit requests
-- Non-super-admin staff can propose edits (acceptance_deadline); super admin approves.
-- Also fixes waiver notification deep-link (/admissions → /admissions/<lead_id>).

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. offer_letter_edit_requests table
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.offer_letter_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_letter_id uuid NOT NULL REFERENCES public.offer_letters(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id),
  requested_by_name text,
  requested_by_role text,
  proposed_changes jsonb NOT NULL DEFAULT '{}',
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_edit_requests_offer
  ON public.offer_letter_edit_requests (offer_letter_id, status);
CREATE INDEX IF NOT EXISTS idx_offer_edit_requests_pending
  ON public.offer_letter_edit_requests (status) WHERE status = 'pending';

ALTER TABLE public.offer_letter_edit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view offer edit requests" ON public.offer_letter_edit_requests;
CREATE POLICY "Staff can view offer edit requests"
  ON public.offer_letter_edit_requests FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'campus_admin')
  );

DROP POLICY IF EXISTS "Staff can insert offer edit requests" ON public.offer_letter_edit_requests;
CREATE POLICY "Staff can insert offer edit requests"
  ON public.offer_letter_edit_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'campus_admin')
  );

DROP POLICY IF EXISTS "Super admin can decide offer edit requests" ON public.offer_letter_edit_requests;
CREATE POLICY "Super admin can decide offer edit requests"
  ON public.offer_letter_edit_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT, INSERT ON public.offer_letter_edit_requests TO authenticated;
GRANT ALL ON public.offer_letter_edit_requests TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. BEFORE INSERT: stamp requester metadata
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_offer_edit_request_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role  text;
  v_name  text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor LIMIT 1;
    SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_actor LIMIT 1;
    NEW.requested_by      := COALESCE(NEW.requested_by, v_actor);
    NEW.requested_by_role := COALESCE(NEW.requested_by_role, v_role);
    NEW.requested_by_name := COALESCE(NEW.requested_by_name, v_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_edit_request_before_insert ON public.offer_letter_edit_requests;
CREATE TRIGGER offer_edit_request_before_insert
BEFORE INSERT ON public.offer_letter_edit_requests
FOR EACH ROW EXECUTE FUNCTION public.handle_offer_edit_request_insert();

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. updated_at maintenance
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_offer_edit_requests_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS offer_edit_requests_set_updated_at ON public.offer_letter_edit_requests;
CREATE TRIGGER offer_edit_requests_set_updated_at
BEFORE UPDATE ON public.offer_letter_edit_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_offer_edit_requests_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. AFTER INSERT: notify super admins when a pending edit request arrives
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_offer_edit_request_pending()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead_id   uuid;
  v_lead_name text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT o.lead_id, l.name
    INTO v_lead_id, v_lead_name
    FROM public.offer_letters o
    JOIN public.leads l ON l.id = o.lead_id
   WHERE o.id = NEW.offer_letter_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
  SELECT
    ur.user_id,
    'approval_pending',
    'Offer letter edit pending approval',
    COALESCE(NEW.requested_by_name, 'Staff') || ' requested edits to the offer letter for ' ||
      COALESCE(v_lead_name, 'a lead') ||
      CASE WHEN NEW.reason IS NOT NULL AND NEW.reason <> ''
           THEN ': ' || NEW.reason ELSE '' END,
    format('/admissions/%s', v_lead_id),
    v_lead_id
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_edit_request_notify_pending ON public.offer_letter_edit_requests;
CREATE TRIGGER offer_edit_request_notify_pending
AFTER INSERT ON public.offer_letter_edit_requests
FOR EACH ROW WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.notify_offer_edit_request_pending();

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. AFTER UPDATE: notify requester when edit request is decided
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_offer_edit_request_decided()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
  IF NEW.requested_by IS NULL THEN RETURN NEW; END IF;

  SELECT lead_id INTO v_lead_id FROM public.offer_letters WHERE id = NEW.offer_letter_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
  VALUES (
    NEW.requested_by,
    'approval_decided',
    CASE WHEN NEW.status = 'approved'
         THEN 'Offer letter edit approved'
         ELSE 'Offer letter edit rejected' END,
    'Your edit request for the offer letter has been ' || NEW.status ||
      CASE WHEN NEW.status = 'rejected' AND NEW.rejection_reason IS NOT NULL
           THEN ': ' || NEW.rejection_reason ELSE '' END,
    format('/admissions/%s', v_lead_id),
    v_lead_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_edit_request_notify_decided ON public.offer_letter_edit_requests;
CREATE TRIGGER offer_edit_request_notify_decided
AFTER UPDATE OF status ON public.offer_letter_edit_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_offer_edit_request_decided();

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. AFTER UPDATE: apply approved changes to offer_letters
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_offer_edit_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.status = NEW.status OR NEW.status <> 'approved' THEN RETURN NEW; END IF;

  UPDATE public.offer_letters
  SET acceptance_deadline = CASE
        WHEN NEW.proposed_changes ? 'acceptance_deadline'
        THEN (NEW.proposed_changes->>'acceptance_deadline')::date
        ELSE acceptance_deadline
      END
  WHERE id = NEW.offer_letter_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_edit_request_apply_changes ON public.offer_letter_edit_requests;
CREATE TRIGGER offer_edit_request_apply_changes
AFTER UPDATE OF status ON public.offer_letter_edit_requests
FOR EACH ROW WHEN (NEW.status = 'approved')
EXECUTE FUNCTION public.apply_offer_edit_request();

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Update pending_approvals view to include offer edit requests
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.pending_approvals AS

SELECT
  'concession'::text AS kind,
  c.id::text AS id,
  c.status AS status,
  c.student_id::text AS subject_id,
  s.name AS subject_name,
  c.type AS detail_type,
  c.value AS detail_value,
  c.reason AS reason,
  c.requested_by::text AS requested_by_id,
  c.created_at AS created_at,
  CASE
    WHEN c.status = 'pending_principal' THEN 'principal'
    WHEN c.status = 'pending_super_admin' THEN 'super_admin'
    ELSE NULL
  END AS pending_role
FROM public.concessions c
LEFT JOIN public.students s ON s.id = c.student_id
WHERE c.status IN ('pending_principal', 'pending_super_admin')

UNION ALL

SELECT
  'offer_letter'::text AS kind,
  ol.id::text AS id,
  ol.approval_status AS status,
  ol.lead_id::text AS subject_id,
  l.name AS subject_name,
  'flat'::text AS detail_type,
  ol.net_fee AS detail_value,
  NULL::text AS reason,
  ol.issued_by::text AS requested_by_id,
  ol.created_at AS created_at,
  'principal'::text AS pending_role
FROM public.offer_letters ol
LEFT JOIN public.leads l ON l.id = ol.lead_id
WHERE ol.approval_status = 'pending_principal'

UNION ALL

SELECT
  'offer_edit'::text AS kind,
  er.id::text AS id,
  er.status AS status,
  ol.lead_id::text AS subject_id,
  l.name AS subject_name,
  'edit_request'::text AS detail_type,
  NULL::numeric AS detail_value,
  er.reason AS reason,
  er.requested_by::text AS requested_by_id,
  er.created_at AS created_at,
  'super_admin'::text AS pending_role
FROM public.offer_letter_edit_requests er
JOIN public.offer_letters ol ON ol.id = er.offer_letter_id
LEFT JOIN public.leads l ON l.id = ol.lead_id
WHERE er.status = 'pending'

UNION ALL

SELECT
  'lead_deletion'::text AS kind,
  ldr.id::text AS id,
  'pending_admin'::text AS status,
  ldr.lead_id::text AS subject_id,
  l.name AS subject_name,
  ldr.reason AS detail_type,
  NULL::numeric AS detail_value,
  ldr.custom_message AS reason,
  ldr.requested_by::text AS requested_by_id,
  ldr.created_at AS created_at,
  'super_admin'::text AS pending_role
FROM public.lead_deletion_requests ldr
LEFT JOIN public.leads l ON l.id = ldr.lead_id
WHERE ldr.status = 'pending';

GRANT SELECT ON public.pending_approvals TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Fix waiver notification deep-link (was /admissions, now /admissions/<id>)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_offer_waiver_pending()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead_id   uuid;
  v_lead_name text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT o.lead_id, l.name
    INTO v_lead_id, v_lead_name
    FROM public.offer_letters o
    JOIN public.leads l ON l.id = o.lead_id
   WHERE o.id = NEW.offer_letter_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
  SELECT
    ur.user_id,
    'approval_pending',
    'Waiver pending approval',
    COALESCE(NEW.requested_by_name, 'Staff') ||
      ' requested a ' || REPLACE(NEW.term, '_', ' ') ||
      ' waiver of ₹' || to_char(NEW.amount, 'FM9,99,99,990') ||
      ' for ' || COALESCE(v_lead_name, 'a lead'),
    format('/admissions/%s', v_lead_id),
    v_lead_id
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin';

  RETURN NEW;
END;
$$;
