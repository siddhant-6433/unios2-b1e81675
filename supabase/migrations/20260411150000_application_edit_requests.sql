-- Allow counsellors/admins to request temporary edit access for a paid application
-- so the candidate can go back to the apply portal and fix locked tabs.
-- Requires approval from admission_head / super_admin.

-- 1. Unlock fields on applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS edit_unlocked_until timestamptz,
  ADD COLUMN IF NOT EXISTS edit_unlocked_sections text[] DEFAULT NULL;

-- 2. Request table
CREATE TABLE public.application_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_by_name text,
  requested_by_role text,
  reason text NOT NULL,
  sections text[] DEFAULT NULL,                 -- NULL/empty = all pre-payment sections
  duration_hours int NOT NULL DEFAULT 24,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired','used')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_by_name text,
  reviewed_by_role text,
  reviewed_at timestamptz,
  review_notes text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_edit_requests_app ON public.application_edit_requests(application_id, created_at DESC);
CREATE INDEX idx_edit_requests_status ON public.application_edit_requests(status) WHERE status = 'pending';

ALTER TABLE public.application_edit_requests ENABLE ROW LEVEL SECURITY;

-- Staff read
CREATE POLICY "Staff read edit requests" ON public.application_edit_requests
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

-- Counsellors and higher can create requests
CREATE POLICY "Staff create edit requests" ON public.application_edit_requests
  FOR INSERT TO authenticated WITH CHECK (
    requested_by = auth.uid() AND (
      public.has_role(auth.uid(), 'super_admin') OR
      public.has_role(auth.uid(), 'campus_admin') OR
      public.has_role(auth.uid(), 'principal') OR
      public.has_role(auth.uid(), 'admission_head') OR
      public.has_role(auth.uid(), 'counsellor')
    )
  );

-- Only admission_head / super_admin / principal can review
CREATE POLICY "Admins review edit requests" ON public.application_edit_requests
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'principal')
  );

GRANT SELECT, INSERT, UPDATE ON public.application_edit_requests TO authenticated;
GRANT ALL ON public.application_edit_requests TO service_role;

-- 3. RPC: Counsellor submits a request
CREATE OR REPLACE FUNCTION public.request_application_edit_access(
  _application_id uuid,
  _reason text,
  _sections text[] DEFAULT NULL,
  _duration_hours int DEFAULT 24
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_user_role text;
  v_request_id uuid;
BEGIN
  IF NOT (
    has_role(v_user_id, 'super_admin') OR
    has_role(v_user_id, 'campus_admin') OR
    has_role(v_user_id, 'principal') OR
    has_role(v_user_id, 'admission_head') OR
    has_role(v_user_id, 'counsellor')
  ) THEN
    RAISE EXCEPTION 'Only staff can request edit access';
  END IF;

  SELECT display_name INTO v_user_name FROM profiles WHERE user_id = v_user_id;
  SELECT role::text INTO v_user_role FROM user_roles WHERE user_id = v_user_id LIMIT 1;

  INSERT INTO application_edit_requests (
    application_id, requested_by, requested_by_name, requested_by_role,
    reason, sections, duration_hours, status
  ) VALUES (
    _application_id, v_user_id, v_user_name, v_user_role,
    _reason, _sections, _duration_hours, 'pending'
  ) RETURNING id INTO v_request_id;

  -- Auto-approve if requester is admission_head / super_admin / principal
  IF v_user_role IN ('super_admin', 'admission_head', 'principal') THEN
    UPDATE application_edit_requests
    SET status = 'approved',
        reviewed_by = v_user_id,
        reviewed_by_name = v_user_name,
        reviewed_by_role = v_user_role,
        reviewed_at = now(),
        expires_at = now() + (_duration_hours || ' hours')::interval,
        review_notes = 'Auto-approved (self-approval by admin)'
    WHERE id = v_request_id;

    UPDATE applications
    SET edit_unlocked_until = now() + (_duration_hours || ' hours')::interval,
        edit_unlocked_sections = _sections
    WHERE id = _application_id;
  END IF;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_application_edit_access TO authenticated;

-- 4. RPC: Admin approves / rejects a request
CREATE OR REPLACE FUNCTION public.review_application_edit_request(
  _request_id uuid,
  _decision text,   -- 'approved' or 'rejected'
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_user_role text;
  v_req record;
BEGIN
  IF NOT (
    has_role(v_user_id, 'super_admin') OR
    has_role(v_user_id, 'admission_head') OR
    has_role(v_user_id, 'principal')
  ) THEN
    RAISE EXCEPTION 'Only admission head / principal / super admin can review edit requests';
  END IF;

  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected';
  END IF;

  SELECT * INTO v_req FROM application_edit_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request already %', v_req.status;
  END IF;

  SELECT display_name INTO v_user_name FROM profiles WHERE user_id = v_user_id;
  SELECT role::text INTO v_user_role FROM user_roles WHERE user_id = v_user_id LIMIT 1;

  UPDATE application_edit_requests
  SET status = _decision,
      reviewed_by = v_user_id,
      reviewed_by_name = v_user_name,
      reviewed_by_role = v_user_role,
      reviewed_at = now(),
      review_notes = _notes,
      expires_at = CASE WHEN _decision = 'approved'
                        THEN now() + (v_req.duration_hours || ' hours')::interval
                        ELSE NULL END
  WHERE id = _request_id;

  -- If approved, unlock the application
  IF _decision = 'approved' THEN
    UPDATE applications
    SET edit_unlocked_until = now() + (v_req.duration_hours || ' hours')::interval,
        edit_unlocked_sections = v_req.sections
    WHERE id = v_req.application_id;
  END IF;

  RETURN jsonb_build_object(
    'status', _decision,
    'expires_at', CASE WHEN _decision = 'approved'
                       THEN now() + (v_req.duration_hours || ' hours')::interval
                       ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_application_edit_request TO authenticated;

-- 5. RPC: Revoke unlock (if counsellor wants to cancel early)
CREATE OR REPLACE FUNCTION public.revoke_application_edit_unlock(_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT (
    has_role(v_user_id, 'super_admin') OR
    has_role(v_user_id, 'admission_head') OR
    has_role(v_user_id, 'principal')
  ) THEN
    RAISE EXCEPTION 'Only admins can revoke edit access';
  END IF;

  UPDATE applications
  SET edit_unlocked_until = NULL,
      edit_unlocked_sections = NULL
  WHERE id = _application_id;

  -- Expire any active approved requests
  UPDATE application_edit_requests
  SET status = 'expired'
  WHERE application_id = _application_id
    AND status = 'approved';
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_application_edit_unlock TO authenticated;
