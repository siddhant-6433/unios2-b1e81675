-- GNM university-deposit challan is optional. Direct admits (no counselling)
-- do not pay UPSMF/ABVMU separately; the seat-reservation amount stays inside
-- Year-1 college tuition. Counselling admits still record the challan.
--
-- lead_abvmu_deposit_amount returns 0 when marked not-applicable so the fee
-- split, lump-sum withhold, and applicant ABVMU card all drop automatically.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS abvmu_deposit_not_applicable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leads.abvmu_deposit_not_applicable IS
  'GNM only. True when the candidate joined without counselling, so the university seat deposit is collected as Year-1 college tuition instead of a separate ABVMU/UPSMF challan.';

CREATE OR REPLACE FUNCTION public.lead_course_is_gnm(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = _lead_id
      AND (
        c.name ILIKE '%gnm%'
        OR c.name ILIKE '%general nursing%'
        OR c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.lead_course_is_gnm(uuid) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.lead_abvmu_deposit_amount(_lead_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric := 0;
BEGIN
  IF COALESCE((
    SELECT abvmu_deposit_not_applicable FROM public.leads WHERE id = _lead_id
  ), false) THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(
    NULLIF((fs.metadata->>'seat_reservation_deposit')::numeric, 0),
    0
  )
    INTO v_amount
    FROM public.leads l
    LEFT JOIN LATERAL (
      SELECT metadata
      FROM public.fee_structures
      WHERE course_id = l.course_id
        AND is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    ) fs ON true
   WHERE l.id = _lead_id;

  RETURN COALESCE(v_amount, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_abvmu_deposit_amount(uuid) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.set_abvmu_deposit_not_applicable(
  _lead_id uuid,
  _not_applicable boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_staff boolean;
BEGIN
  IF _lead_id IS NULL THEN
    RAISE EXCEPTION 'lead_id is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = _lead_id) THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;
  IF NOT public.lead_course_is_gnm(_lead_id) THEN
    RAISE EXCEPTION 'University-deposit not-applicable is only for GNM (direct admission without counselling)';
  END IF;

  v_staff := v_uid IS NOT NULL AND (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'campus_admin'::app_role)
    OR public.has_role(v_uid, 'principal'::app_role)
    OR public.has_role(v_uid, 'admission_head'::app_role)
    OR public.has_role(v_uid, 'counsellor'::app_role)
    OR public.has_role(v_uid, 'accountant'::app_role)
    OR public.has_role(v_uid, 'office_admin'::app_role)
    OR public.has_role(v_uid, 'data_entry'::app_role)
    OR public.has_role(v_uid, 'office_assistant'::app_role)
  );
  IF NOT v_staff THEN
    RAISE EXCEPTION 'Only staff can mark the GNM university deposit not applicable';
  END IF;

  IF _not_applicable AND EXISTS (
    SELECT 1 FROM public.abvmu_deposit_claims
     WHERE lead_id = _lead_id
       AND status IN ('pending', 'approved', 'settled')
  ) THEN
    RAISE EXCEPTION 'Cannot mark not applicable while an ABVMU challan is pending, approved, or settled';
  END IF;

  UPDATE public.leads
     SET abvmu_deposit_not_applicable = _not_applicable,
         updated_at = now()
   WHERE id = _lead_id;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (
    _lead_id,
    (SELECT id FROM public.profiles WHERE user_id = v_uid LIMIT 1),
    'info_update',
    CASE WHEN _not_applicable THEN
      'GNM university deposit marked not applicable (direct admission / no counselling) — amount included in Year 1 tuition'
    ELSE
      'GNM university deposit restored — ABVMU/UPSMF challan can be recorded again'
    END
  );

  RETURN jsonb_build_object(
    'lead_id', _lead_id,
    'abvmu_deposit_not_applicable', _not_applicable,
    'abvmu_deposit_amount', public.lead_abvmu_deposit_amount(_lead_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_abvmu_deposit_not_applicable(uuid, boolean)
  TO authenticated, service_role;
