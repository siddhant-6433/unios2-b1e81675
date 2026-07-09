-- ====================================================================
-- CBSE Transfer Certificate (TC) generation + approval workflow.
--   Schools: NIMT School Arthala (campus GZ1) and
--            NIMT School Avantika II (campus GZ3).
--   Staff draft a TC pre-filled from student data; a hard fee-clearance
--   gate blocks issuance until dues are zero; principal / super_admin
--   approves, which assigns a per-school-per-session serial number.
--   PDF is rendered by the generate-transfer-certificate edge function.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. School header config on institution_branding + seed two schools.
--    (affiliation_no / principal_name / seal_url values are supplied
--     by the school later; NULLs are safe — renderer degrades to a
--     signature line and blank affiliation.)
-- --------------------------------------------------------------------
ALTER TABLE public.institution_branding
  ADD COLUMN IF NOT EXISTS affiliation_no   text,   -- CBSE affiliation number
  ADD COLUMN IF NOT EXISTS principal_name   text,
  ADD COLUMN IF NOT EXISTS seal_url         text,   -- PNG (transparent) school seal
  ADD COLUMN IF NOT EXISTS tc_serial_prefix text;   -- e.g. 'NIMT/ARTHALA/TC'

INSERT INTO public.institution_branding (slug, name, address, tc_serial_prefix)
VALUES
  ('nimt_school_arthala',   'NIMT School Arthala',
   'NIMT School, Arthala, Ghaziabad',                'NIMT/ARTHALA/TC'),
  ('nimt_school_avantika2', 'NIMT School Avantika II',
   'NIMT School, Avantika II, Ghaziabad',            'NIMT/AVANTIKA-II/TC')
ON CONFLICT (slug) DO NOTHING;

-- Point the two Ghaziabad school campuses at their branding rows.
UPDATE public.campuses SET branding_slug = 'nimt_school_arthala'   WHERE code = 'GZ1';
UPDATE public.campuses SET branding_slug = 'nimt_school_avantika2' WHERE code = 'GZ3';

-- Resolver: branding row for a student (campus -> branding_slug -> row),
-- with the is_default row as fallback. Mirrors public.lead_branding.
CREATE OR REPLACE FUNCTION public.student_branding(_student_id uuid)
RETURNS public.institution_branding
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH chain AS (
    SELECT ib.*
      FROM public.students s
      LEFT JOIN public.campuses c ON c.id = s.campus_id
      LEFT JOIN public.institution_branding ib ON ib.slug = c.branding_slug
     WHERE s.id = _student_id AND ib.id IS NOT NULL
     UNION ALL
    SELECT ib.* FROM public.institution_branding ib WHERE ib.is_default = true
  )
  SELECT * FROM chain LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.student_branding(uuid) TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 2. Request + serial-counter tables.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_tc_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  campus_id          uuid REFERENCES public.campuses(id),
  status             text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
  tc_details         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- all 23 CBSE fields
  fee_snapshot       jsonb,                               -- lead_fee_status() at submit
  reason_for_leaving text,
  tc_number          text,                                -- assigned at approval
  issue_date         date,
  tc_pdf_path        text,
  requested_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  approved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  decision_notes     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_tc_requests_student ON public.student_tc_requests (student_id);
CREATE INDEX IF NOT EXISTS idx_student_tc_requests_status  ON public.student_tc_requests (status, campus_id);

DROP TRIGGER IF EXISTS update_student_tc_requests_updated_at ON public.student_tc_requests;
CREATE TRIGGER update_student_tc_requests_updated_at
  BEFORE UPDATE ON public.student_tc_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-school, per-session serial counter. Only touched inside the
-- SECURITY DEFINER approve RPC, so no RLS policy is needed.
-- ponytail: one counter row per (school, year); a row lock is fine at TC volume.
CREATE TABLE IF NOT EXISTS public.tc_number_counters (
  campus_id     uuid NOT NULL REFERENCES public.campuses(id),
  academic_year text NOT NULL,      -- 'YYYY-YY', e.g. '2026-27'
  last_seq      int  NOT NULL DEFAULT 0,
  PRIMARY KEY (campus_id, academic_year)
);

ALTER TABLE public.student_tc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_number_counters  ENABLE ROW LEVEL SECURITY;

-- Staff can read TC requests (writes go through the RPCs below).
CREATE POLICY "Staff can view TC requests"
  ON public.student_tc_requests FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'office_assistant'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
  );

GRANT SELECT ON public.student_tc_requests TO authenticated;
GRANT ALL    ON public.student_tc_requests TO service_role;
GRANT ALL    ON public.tc_number_counters  TO service_role;

-- --------------------------------------------------------------------
-- 3. RPCs (SECURITY DEFINER; enforce roles internally).
-- --------------------------------------------------------------------

-- Academic year (Apr–Mar) string for a given date, e.g. 2026-07-09 -> '2026-27'.
CREATE OR REPLACE FUNCTION public.tc_academic_year(_d date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM _d) >= 4
      THEN EXTRACT(YEAR FROM _d)::int || '-' || lpad(((EXTRACT(YEAR FROM _d)::int + 1) % 100)::text, 2, '0')
    ELSE (EXTRACT(YEAR FROM _d)::int - 1) || '-' || lpad((EXTRACT(YEAR FROM _d)::int % 100)::text, 2, '0')
  END;
$$;

-- Submit a TC request. Hard fee-clearance gate.
CREATE OR REPLACE FUNCTION public.submit_tc_request(_student_id uuid, _details jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_fee     jsonb;
  v_due     numeric;
  v_id      uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'office_assistant'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized to request a transfer certificate';
  END IF;

  SELECT * INTO v_student FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  -- Hard fee gate: requires a linked lead and zero course dues.
  IF v_student.lead_id IS NULL THEN
    RAISE EXCEPTION 'No linked fee record for this student; fee clearance cannot be verified';
  END IF;

  v_fee := public.lead_fee_status(v_student.lead_id);
  v_due := COALESCE((v_fee->>'full_course_amount_due')::numeric, 0);
  IF v_due <> 0 THEN
    RAISE EXCEPTION 'Cannot issue TC: outstanding dues of %', v_due;
  END IF;

  INSERT INTO public.student_tc_requests (
    student_id, campus_id, status, tc_details, fee_snapshot, reason_for_leaving, requested_by
  ) VALUES (
    _student_id, v_student.campus_id, 'pending_approval', COALESCE(_details, '{}'::jsonb), v_fee,
    NULLIF(_details->>'reasonForLeaving', ''), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT ur.user_id,
         'approval_pending',
         'Transfer certificate pending approval',
         COALESCE(v_student.name, 'Student') || ' (' || COALESCE(v_student.admission_no, '—') ||
           ') has a transfer certificate awaiting approval.',
         '/students/' || _student_id
  FROM public.user_roles ur
  WHERE ur.role IN ('super_admin'::public.app_role, 'principal'::public.app_role);

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_tc_request(uuid, jsonb) TO authenticated;

-- Approve a TC request: assigns the per-school-per-session serial.
CREATE OR REPLACE FUNCTION public.approve_tc_request(_request_id uuid, _notes text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req     public.student_tc_requests%ROWTYPE;
  v_ay      text;
  v_prefix  text;
  v_seq     int;
  v_number  text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Only principal or super admin can approve a transfer certificate';
  END IF;

  SELECT * INTO v_req FROM public.student_tc_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Request is not pending approval';
  END IF;

  v_ay := public.tc_academic_year(current_date);
  v_prefix := COALESCE((public.student_branding(v_req.student_id)).tc_serial_prefix, 'TC');

  INSERT INTO public.tc_number_counters (campus_id, academic_year, last_seq)
  VALUES (v_req.campus_id, v_ay, 1)
  ON CONFLICT (campus_id, academic_year)
    DO UPDATE SET last_seq = public.tc_number_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_number := v_prefix || '/' || v_ay || '/' || lpad(v_seq::text, 3, '0');

  UPDATE public.student_tc_requests
  SET status = 'approved',
      tc_number = v_number,
      issue_date = current_date,
      approved_by = auth.uid(),
      approved_at = now(),
      decision_notes = _notes
  WHERE id = _request_id;

  IF v_req.requested_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_req.requested_by, 'approval_decided',
            'Transfer certificate approved',
            'TC ' || v_number || ' approved and ready to generate.',
            '/students/' || v_req.student_id);
  END IF;

  RETURN v_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_tc_request(uuid, text) TO authenticated;

-- Reject a TC request.
CREATE OR REPLACE FUNCTION public.reject_tc_request(_request_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.student_tc_requests%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Only principal or super admin can reject a transfer certificate';
  END IF;

  SELECT * INTO v_req FROM public.student_tc_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Request is not pending approval';
  END IF;

  UPDATE public.student_tc_requests
  SET status = 'rejected',
      approved_by = auth.uid(),
      approved_at = now(),
      decision_notes = _notes
  WHERE id = _request_id;

  IF v_req.requested_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_req.requested_by, 'approval_decided',
            'Transfer certificate rejected',
            'A transfer certificate request was rejected' ||
              COALESCE(': ' || _notes, '') || '.',
            '/students/' || v_req.student_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_tc_request(uuid, text) TO authenticated;
