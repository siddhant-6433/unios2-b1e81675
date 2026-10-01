-- beacon transport fee assignment
-- Keep the transport prices aligned with the NIMT Beacon 2027-28 fee statement.
UPDATE public.fee_structure_items fsi
   SET amount = rates.quarterly_amount
  FROM public.fee_structures fs,
       public.admission_sessions sess,
       public.courses c,
       public.fee_codes fc,
       (VALUES
    ('NB-TR1'::text, 6000::numeric),
    ('NB-TR2'::text, 7500::numeric),
    ('NB-TR3'::text, 10500::numeric)
  ) AS rates(code, quarterly_amount)
 WHERE fs.id = fsi.fee_structure_id
   AND sess.id = fs.session_id
   AND c.id = fs.course_id
   AND fc.id = fsi.fee_code_id
   AND rates.code = fc.code
   AND sess.name = '2027-28'
   AND c.code LIKE 'BSAV-%'
   AND fsi.term IN ('q1', 'q2', 'q3', 'q4');

INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
SELECT fs.id, fc.id, term.term, rates.quarterly_amount, 10
  FROM public.fee_structures fs
  JOIN public.admission_sessions sess ON sess.id = fs.session_id AND sess.name = '2027-28'
  JOIN public.courses c ON c.id = fs.course_id AND c.code LIKE 'BSAV-%'
  CROSS JOIN (VALUES ('q1'::text), ('q2'::text), ('q3'::text), ('q4'::text)) AS term(term)
  JOIN (VALUES
    ('NB-TR1'::text, 6000::numeric),
    ('NB-TR2'::text, 7500::numeric),
    ('NB-TR3'::text, 10500::numeric)
  ) AS rates(code, quarterly_amount) ON true
  JOIN public.fee_codes fc ON fc.code = rates.code
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.fee_structure_items existing
    WHERE existing.fee_structure_id = fs.id
      AND existing.fee_code_id = fc.id
      AND existing.term = term.term
 );

INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('NB-OTR1', 'Beacon Transport (Within 5 Kms - One Way)', 'transport', true),
  ('NB-OTR2', 'Beacon Transport (5-10 Kms - One Way)', 'transport', true),
  ('NB-OTR3', 'Beacon Transport (Over 10 Kms - One Way)', 'transport', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.beacon_transport_fee_defaults (
  session_id uuid NOT NULL REFERENCES public.admission_sessions(id) ON DELETE CASCADE,
  zone text NOT NULL CHECK (zone IN ('zone_1', 'zone_2', 'zone_3')),
  monthly_amount numeric(12, 2) NOT NULL CHECK (monthly_amount > 0),
  PRIMARY KEY (session_id, zone)
);

ALTER TABLE public.beacon_transport_fee_defaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beacon_transport_fee_defaults FROM PUBLIC, anon, authenticated;

INSERT INTO public.beacon_transport_fee_defaults (session_id, zone, monthly_amount)
SELECT sess.id, rates.zone, rates.monthly_amount
  FROM public.admission_sessions sess
 CROSS JOIN (VALUES
   ('zone_1'::text, 2000::numeric),
   ('zone_2'::text, 2500::numeric),
   ('zone_3'::text, 3500::numeric)
 ) AS rates(zone, monthly_amount)
 WHERE sess.name = '2027-28'
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
  IF v_student.session_name <> '2027-28' THEN
    RAISE EXCEPTION 'Beacon transport defaults are configured for session 2027-28';
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
    RAISE EXCEPTION '2027-28 transport rates are missing from the active fee structure';
  END IF;

  RETURN jsonb_build_object('session_name', v_student.session_name, 'monthly_rates', v_rates);
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_beacon_transport_fee(
  _student_id uuid,
  _zone text,
  _one_way boolean,
  _months integer[],
  _monthly_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_options jsonb;
  v_monthly_default numeric;
  v_amount numeric;
  v_fee_code_id uuid;
  v_start_date date;
  v_year integer;
  v_rows integer := 0;
  v_total numeric := 0;
  v_quarter record;
  v_due_date date;
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
  PERFORM 1 FROM public.students WHERE id = _student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;
  IF _zone IS NULL OR _zone NOT IN ('zone_1', 'zone_2', 'zone_3') THEN
    RAISE EXCEPTION 'Invalid transport zone';
  END IF;
  IF _one_way IS NULL THEN RAISE EXCEPTION 'Select one-way or round-trip transport'; END IF;
  IF _months IS NULL OR cardinality(_months) = 0 OR EXISTS (
    SELECT 1 FROM unnest(_months) AS month_num WHERE month_num NOT BETWEEN 1 AND 12
  ) OR cardinality(_months) <> (SELECT count(DISTINCT month_num) FROM unnest(_months) AS month_num) THEN
    RAISE EXCEPTION 'Select one or more unique academic-session months';
  END IF;
  v_options := public.beacon_transport_fee_options(_student_id);
  v_monthly_default := (v_options->'monthly_rates'->>_zone)::numeric;
  IF _one_way THEN v_monthly_default := v_monthly_default / 2; END IF;
  v_amount := round(_monthly_amount, 2);
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount > v_monthly_default THEN
    RAISE EXCEPTION 'Monthly amount must be greater than zero and no more than ₹%', v_monthly_default;
  END IF;

  SELECT sess.start_date INTO v_start_date
    FROM public.students s
    JOIN public.admission_sessions sess ON sess.id = s.session_id
   WHERE s.id = _student_id;
  v_year := extract(year FROM v_start_date)::integer;

  IF EXISTS (
    SELECT 1
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.student_id = _student_id
       AND fc.category = 'transport'
       AND (fl.paid_amount > 0 OR EXISTS (
         SELECT 1 FROM public.fee_ledger_payments flp
          WHERE flp.fee_ledger_id = fl.id AND flp.amount > 0
       ))
  ) THEN
    RAISE EXCEPTION 'Transport charges have payments and cannot be replaced';
  END IF;

  DELETE FROM public.fee_ledger fl
   USING public.fee_codes fc
   WHERE fl.fee_code_id = fc.id
     AND fl.student_id = _student_id
     AND fc.category = 'transport';

  SELECT id INTO v_fee_code_id
    FROM public.fee_codes
   WHERE code = CASE
     WHEN _one_way AND _zone = 'zone_1' THEN 'NB-OTR1'
     WHEN _one_way AND _zone = 'zone_2' THEN 'NB-OTR2'
     WHEN _one_way AND _zone = 'zone_3' THEN 'NB-OTR3'
     WHEN _zone = 'zone_1' THEN 'NB-TR1'
     WHEN _zone = 'zone_2' THEN 'NB-TR2'
     ELSE 'NB-TR3'
   END;
  IF v_fee_code_id IS NULL THEN RAISE EXCEPTION 'Transport fee code is not configured'; END IF;

  FOR v_quarter IN
    SELECT q.term, q.due_month, count(*)::integer AS month_count
      FROM (VALUES
        ('q1'::text, 4::integer, ARRAY[4, 5, 6]::integer[]),
        ('q2'::text, 7::integer, ARRAY[7, 8, 9]::integer[]),
        ('q3'::text, 10::integer, ARRAY[10, 11, 12]::integer[]),
        ('q4'::text, 1::integer, ARRAY[1, 2, 3]::integer[])
      ) AS q(term, due_month, months)
      CROSS JOIN LATERAL unnest(q.months) AS selected_month(month_num)
     WHERE selected_month.month_num = ANY(_months)
     GROUP BY q.term, q.due_month
  LOOP
    v_due_date := make_date(
      v_year + CASE WHEN v_quarter.due_month < 4 THEN 1 ELSE 0 END,
      v_quarter.due_month,
      10
    );
    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    VALUES (_student_id, v_fee_code_id, v_quarter.term,
            v_amount * v_quarter.month_count, v_due_date, 'due');
    v_rows := v_rows + 1;
    v_total := v_total + v_amount * v_quarter.month_count;
  END LOOP;

  RETURN jsonb_build_object('rows_created', v_rows, 'total_amount', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.beacon_transport_fee_options(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_beacon_transport_fee(uuid, text, boolean, integer[], numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beacon_transport_fee_options(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_beacon_transport_fee(uuid, text, boolean, integer[], numeric) TO authenticated;
