-- ====================================================================
-- Token Fee Engine — Phase 2: Year-wise waivers on offer letters
--   1. offer_waivers table — one row per (offer, year) with amount + status
--   2. RLS: any admissions staff can request; only super_admin can approve
--   3. Auto-approve when requested by super_admin (matches existing
--      offer-letter / concession patterns)
--   4. Notify super_admins when a pending waiver lands
--   5. lead_post_scholarship_year_1 now also subtracts approved year_1
--      waivers, so PAN/AN thresholds reflect the real post-discount Year-1
-- ====================================================================

-- 1. offer_waivers ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_letter_id uuid NOT NULL REFERENCES public.offer_letters(id) ON DELETE CASCADE,
  term text NOT NULL,                       -- 'year_1', 'year_2', etc.
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid REFERENCES auth.users(id),
  requested_by_name text,
  requested_by_role text,
  approved_by uuid REFERENCES auth.users(id),
  approved_by_name text,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_waivers_offer
  ON public.offer_waivers (offer_letter_id, status);
CREATE INDEX IF NOT EXISTS idx_offer_waivers_pending
  ON public.offer_waivers (status) WHERE status = 'pending';

COMMENT ON TABLE public.offer_waivers IS
  'Year-wise fee waivers attached to an offer letter. Anyone in admissions can request; only super_admin can approve. Approved waivers reduce the post-scholarship Year-1 baseline used for PAN/AN thresholds.';

ALTER TABLE public.offer_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view offer waivers" ON public.offer_waivers;
CREATE POLICY "Staff can view offer waivers"
  ON public.offer_waivers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'campus_admin')
  );

DROP POLICY IF EXISTS "Staff can insert offer waivers" ON public.offer_waivers;
CREATE POLICY "Staff can insert offer waivers"
  ON public.offer_waivers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'campus_admin')
  );

DROP POLICY IF EXISTS "Super admin can decide offer waivers" ON public.offer_waivers;
CREATE POLICY "Super admin can decide offer waivers"
  ON public.offer_waivers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT, INSERT ON public.offer_waivers TO authenticated;
GRANT ALL ON public.offer_waivers TO service_role;

-- 2. BEFORE INSERT: stamp requester metadata + auto-approve super_admin --
CREATE OR REPLACE FUNCTION public.handle_offer_waiver_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role  text;
  v_name  text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT role::text INTO v_role
      FROM public.user_roles WHERE user_id = v_actor LIMIT 1;
    SELECT display_name INTO v_name
      FROM public.profiles WHERE user_id = v_actor LIMIT 1;

    NEW.requested_by      := COALESCE(NEW.requested_by, v_actor);
    NEW.requested_by_role := COALESCE(NEW.requested_by_role, v_role);
    NEW.requested_by_name := COALESCE(NEW.requested_by_name, v_name);

    -- Super admin's own waiver is auto-approved (no self-approval ceremony).
    IF v_role = 'super_admin' AND NEW.status = 'pending' THEN
      NEW.status         := 'approved';
      NEW.approved_by    := v_actor;
      NEW.approved_by_name := v_name;
      NEW.approved_at    := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_waivers_before_insert ON public.offer_waivers;
CREATE TRIGGER offer_waivers_before_insert
BEFORE INSERT ON public.offer_waivers
FOR EACH ROW EXECUTE FUNCTION public.handle_offer_waiver_insert();

-- 3. updated_at maintenance trigger
CREATE OR REPLACE FUNCTION public.tg_offer_waivers_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS offer_waivers_set_updated_at ON public.offer_waivers;
CREATE TRIGGER offer_waivers_set_updated_at
BEFORE UPDATE ON public.offer_waivers
FOR EACH ROW EXECUTE FUNCTION public.tg_offer_waivers_updated_at();

-- 4. AFTER INSERT: notify super_admins when a pending waiver lands -------
CREATE OR REPLACE FUNCTION public.notify_offer_waiver_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      ' waiver of Rs. ' || to_char(NEW.amount, 'FM9G99G99G990D00') ||
      ' for ' || COALESCE(v_lead_name, 'a lead'),
    '/admissions',
    v_lead_id
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_waivers_notify_pending ON public.offer_waivers;
CREATE TRIGGER offer_waivers_notify_pending
AFTER INSERT ON public.offer_waivers
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.notify_offer_waiver_pending();

-- 5. AFTER UPDATE: notify requester when their waiver is decided ---------
CREATE OR REPLACE FUNCTION public.notify_offer_waiver_decided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
  IF NEW.requested_by IS NULL THEN RETURN NEW; END IF;

  SELECT lead_id INTO v_lead_id FROM public.offer_letters
   WHERE id = NEW.offer_letter_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
  VALUES (
    NEW.requested_by,
    'approval_decided',
    CASE WHEN NEW.status = 'approved' THEN 'Waiver approved' ELSE 'Waiver rejected' END,
    REPLACE(NEW.term, '_', ' ') || ' waiver of Rs. ' ||
      to_char(NEW.amount, 'FM9G99G99G990D00') || ' was ' || NEW.status ||
      CASE WHEN NEW.status = 'rejected' AND NEW.rejection_reason IS NOT NULL
           THEN ': ' || NEW.rejection_reason ELSE '' END,
    '/admissions',
    v_lead_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_waivers_notify_decided ON public.offer_waivers;
CREATE TRIGGER offer_waivers_notify_decided
AFTER UPDATE OF status ON public.offer_waivers
FOR EACH ROW EXECUTE FUNCTION public.notify_offer_waiver_decided();

-- 6. Update lead_post_scholarship_year_1 to factor approved year_1 waivers
CREATE OR REPLACE FUNCTION public.lead_post_scholarship_year_1(_lead_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_y1          numeric := public.lead_first_year_fee(_lead_id);
  v_offer_id    uuid;
  v_sch         numeric := 0;
  v_y1_waivers  numeric := 0;
BEGIN
  SELECT id, COALESCE(scholarship_amount, 0)
    INTO v_offer_id, v_sch
    FROM public.offer_letters
   WHERE lead_id = _lead_id
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_offer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0)
      INTO v_y1_waivers
      FROM public.offer_waivers
     WHERE offer_letter_id = v_offer_id
       AND status = 'approved'
       AND term = 'year_1';
  END IF;

  RETURN GREATEST(0, v_y1 - LEAST(v_sch + v_y1_waivers, v_y1));
END;
$$;
