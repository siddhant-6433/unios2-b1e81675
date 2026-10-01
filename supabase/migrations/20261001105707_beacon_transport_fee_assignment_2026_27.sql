-- beacon transport fee assignment 2026 27

INSERT INTO public.beacon_transport_fee_defaults (session_id, zone, monthly_amount)
SELECT sess.id, rates.zone, rates.monthly_amount
  FROM public.admission_sessions sess
 CROSS JOIN (VALUES
   ('zone_1'::text, 1800::numeric),
   ('zone_2'::text, 2500::numeric),
   ('zone_3'::text, 3500::numeric)
 ) AS rates(zone, monthly_amount)
 WHERE sess.name = '2026-27'
ON CONFLICT (session_id, zone) DO UPDATE
  SET monthly_amount = EXCLUDED.monthly_amount;

CREATE OR REPLACE FUNCTION public.beacon_transport_fee_options(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_student record;
  v_structure_id uuid;
  v_rates jsonb;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'office_admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized to assign transport fees';
  END IF;

  SELECT s.course_id, s.session_id, s.fee_structure_version, c.code AS course_code,
         sess.name AS session_name
    INTO v_student
    FROM public.students s
    JOIN public.courses c ON c.id = s.course_id
    JOIN public.admission_sessions sess ON sess.id = s.session_id
   WHERE s.id = _student_id;

  IF v_student.course_id IS NULL OR v_student.course_code NOT LIKE 'BSAV-%' THEN
    RAISE EXCEPTION 'Selective transport assignment is only available for NIMT Beacon students';
  END IF;
  IF v_student.session_name NOT IN ('2026-27', '2027-28') THEN
    RAISE EXCEPTION 'Beacon transport defaults are not configured for session %', v_student.session_name;
  END IF;

  SELECT fs.id INTO v_structure_id
    FROM public.fee_structures fs
   WHERE fs.course_id = v_student.course_id
     AND fs.session_id = v_student.session_id
     AND fs.is_active
   ORDER BY CASE
     WHEN fs.version = COALESCE(v_student.fee_structure_version, 'new_admission') THEN 0
     WHEN fs.version = 'standard' THEN 1
     ELSE 2
   END, fs.created_at DESC
   LIMIT 1;

  SELECT jsonb_build_object(
    'zone_1', COALESCE(max(fsi.amount) FILTER (WHERE fc.code = 'NB-TR1') / 3,
      (SELECT monthly_amount FROM public.beacon_transport_fee_defaults WHERE session_id = v_student.session_id AND zone = 'zone_1')),
    'zone_2', COALESCE(max(fsi.amount) FILTER (WHERE fc.code = 'NB-TR2') / 3,
      (SELECT monthly_amount FROM public.beacon_transport_fee_defaults WHERE session_id = v_student.session_id AND zone = 'zone_2')),
    'zone_3', COALESCE(max(fsi.amount) FILTER (WHERE fc.code = 'NB-TR3') / 3,
      (SELECT monthly_amount FROM public.beacon_transport_fee_defaults WHERE session_id = v_student.session_id AND zone = 'zone_3'))
  ) INTO v_rates
    FROM public.fee_structure_items fsi
    JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
   WHERE fsi.fee_structure_id = v_structure_id
     AND fsi.term = 'q1'
     AND fc.code IN ('NB-TR1', 'NB-TR2', 'NB-TR3');

  IF v_rates IS NULL OR v_rates->>'zone_1' IS NULL OR v_rates->>'zone_2' IS NULL OR v_rates->>'zone_3' IS NULL THEN
    RAISE EXCEPTION 'Beacon transport rates are missing from the active fee structure';
  END IF;

  RETURN jsonb_build_object('session_name', v_student.session_name, 'monthly_rates', v_rates);
END;
$function$;
