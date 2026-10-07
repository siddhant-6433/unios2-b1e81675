-- D.Pharma fee structures use seat_reservation_deposit for their regular fee plan,
-- not an ABVMU deposit. Keep the regular tuition together in Year 1.

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
  IF EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = _lead_id
      AND (
        c.code = 'DPHARMA-GN'
        OR c.webflow_slug = 'diploma-in-pharmacy'
        OR c.name ILIKE '%d.pharma%'
        OR c.name ILIKE '%diploma%pharmacy%'
      )
  ) THEN
    RETURN 0;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.lead_abvmu_deposit_amount(uuid)
  TO authenticated, anon, service_role;
