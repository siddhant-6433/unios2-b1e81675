-- Offer letter approval workflow + unified pending approvals view
-- + approval_pending notification type

-- =====================================================
-- 1. offer_letters approval columns
-- =====================================================
ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending_principal', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN public.offer_letters.approval_status IS
  'When counsellor issues an offer, it starts as pending_principal. When principal/super_admin issues directly, it is approved.';

-- =====================================================
-- 2. Add approval_pending notification type
-- =====================================================
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned', 'sla_warning', 'lead_reclaimed',
  'followup_due', 'followup_overdue', 'visit_confirmation_due',
  'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
  'whatsapp_message', 'approval_pending', 'approval_decided'
));

-- =====================================================
-- 3. Unified pending approvals view
-- =====================================================
-- Combines pending items from concessions, offer_letters, and lead_deletion_requests
-- so the Overview dashboard + sidebar badge can show a single count.
CREATE OR REPLACE VIEW public.pending_approvals AS
-- Concessions pending principal approval
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

-- Offer letters pending principal approval
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

-- Lead deletion requests pending admin action
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

-- =====================================================
-- 4. RPC: count pending approvals for current user's role
-- =====================================================
CREATE OR REPLACE FUNCTION public.count_pending_approvals()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM pending_approvals pa
  WHERE
    -- Super admin sees everything
    has_role(auth.uid(), 'super_admin')
    -- Principal sees items pending principal approval
    OR (has_role(auth.uid(), 'principal') AND pa.pending_role = 'principal')
    -- Campus admin / admission head also see pending items (they help manage approvals)
    OR (has_role(auth.uid(), 'campus_admin') AND pa.pending_role = 'super_admin')
    OR (has_role(auth.uid(), 'admission_head') AND pa.pending_role = 'principal');
$$;

GRANT EXECUTE ON FUNCTION public.count_pending_approvals TO authenticated;

-- =====================================================
-- 5. Trigger: notify approvers when a new item goes pending
-- =====================================================

-- Concession created with pending status → notify principals
CREATE OR REPLACE FUNCTION public.fn_notify_concession_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role app_role;
  v_user_id uuid;
  v_student_name text;
BEGIN
  -- Determine target role based on status
  IF NEW.status = 'pending_principal' THEN
    v_role := 'principal'::app_role;
  ELSIF NEW.status = 'pending_super_admin' THEN
    v_role := 'super_admin'::app_role;
  ELSE
    RETURN NEW;
  END IF;

  SELECT name INTO v_student_name FROM students WHERE id = NEW.student_id;

  -- Notify all users with the target role
  FOR v_user_id IN
    SELECT user_id FROM user_roles WHERE role = v_role
  LOOP
    INSERT INTO notifications (user_id, type, title, body, link)
    VALUES (
      v_user_id,
      'approval_pending',
      'Concession approval pending',
      format('Concession request for %s awaiting your approval', COALESCE(v_student_name, 'student')),
      '/finance?tab=concessions'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_concession_pending ON public.concessions;
CREATE TRIGGER trg_notify_concession_pending
  AFTER INSERT OR UPDATE OF status ON public.concessions
  FOR EACH ROW
  WHEN (NEW.status IN ('pending_principal', 'pending_super_admin'))
  EXECUTE FUNCTION public.fn_notify_concession_pending();

-- Offer letter created with pending status → notify principals
CREATE OR REPLACE FUNCTION public.fn_notify_offer_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_lead_name text;
BEGIN
  IF NEW.approval_status <> 'pending_principal' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_lead_name FROM leads WHERE id = NEW.lead_id;

  FOR v_user_id IN
    SELECT user_id FROM user_roles WHERE role = 'principal'::app_role
  LOOP
    INSERT INTO notifications (user_id, type, title, body, link)
    VALUES (
      v_user_id,
      'approval_pending',
      'Offer letter approval pending',
      format('Offer letter for %s (₹%s) awaiting your approval',
             COALESCE(v_lead_name, 'lead'),
             to_char(NEW.net_fee, 'FM999,999,999')),
      format('/admissions/%s', NEW.lead_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_offer_pending ON public.offer_letters;
CREATE TRIGGER trg_notify_offer_pending
  AFTER INSERT OR UPDATE OF approval_status ON public.offer_letters
  FOR EACH ROW
  WHEN (NEW.approval_status = 'pending_principal')
  EXECUTE FUNCTION public.fn_notify_offer_pending();

-- Notify issuer when their offer letter is approved/rejected
CREATE OR REPLACE FUNCTION public.fn_notify_offer_decided()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_name text;
  v_title text;
BEGIN
  IF NEW.approval_status = OLD.approval_status THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_status NOT IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  IF NEW.issued_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_lead_name FROM leads WHERE id = NEW.lead_id;
  v_title := CASE
    WHEN NEW.approval_status = 'approved' THEN 'Offer letter approved'
    ELSE 'Offer letter rejected'
  END;

  INSERT INTO notifications (user_id, type, title, body, link)
  VALUES (
    NEW.issued_by,
    'approval_decided',
    v_title,
    format('Offer for %s has been %s', COALESCE(v_lead_name, 'lead'), NEW.approval_status),
    format('/admissions/%s', NEW.lead_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_offer_decided ON public.offer_letters;
CREATE TRIGGER trg_notify_offer_decided
  AFTER UPDATE OF approval_status ON public.offer_letters
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_offer_decided();
