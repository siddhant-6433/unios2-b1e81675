-- fee collection collected scope
-- Add a collected-only scope to Finance -> Reports -> Collection vs Due.
-- It returns confirmed receipt allocation rows with receipt number and payment
-- mode so Finance can audit collections candidate-wise.

CREATE OR REPLACE FUNCTION public.fee_collection_vs_due_report(
  _campus_ids uuid[] DEFAULT NULL::uuid[],
  _scope text DEFAULT 'till_date'::text,
  _as_of date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text;
  v_as_of date;
  v_lines jsonb;
BEGIN
  v_as_of := COALESCE(_as_of, CURRENT_DATE);
  v_scope := lower(COALESCE(NULLIF(btrim(_scope), ''), 'till_date'));
  IF v_scope NOT IN ('till_date', 'entire_batch', 'overdue', 'collected') THEN
    v_scope := 'till_date';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_permission(auth.uid(), 'finance:view')
  ) THEN
    RETURN jsonb_build_object(
      'as_of', v_as_of,
      'scope', v_scope,
      'lines', '[]'::jsonb
    );
  END IF;

  IF v_scope = 'collected' THEN
    WITH collected_lines AS (
      SELECT
        fl.student_id,
        s.name,
        s.admission_no,
        cp.name AS campus_name,
        co.id AS course_id,
        co.name AS course_name,
        b.name AS batch_name,
        ase.name AS session_name,
        fl.id AS fee_ledger_id,
        fc.code AS fee_code,
        fc.name AS fee_name,
        fl.term,
        0::numeric AS due_amount,
        flp.amount AS collected_amount,
        0::numeric AS balance,
        fl.due_date,
        (lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date AS collected_date,
        0::numeric AS late_fine_due,
        0::numeric AS late_fine_collected,
        false AS is_overdue,
        lp.id AS payment_id,
        lp.receipt_no,
        lp.payment_mode,
        lp.transaction_ref,
        lp.type AS payment_type,
        (lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date AS payment_date,
        flp.id AS fee_ledger_payment_id
      FROM public.fee_ledger_payments flp
      JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
      JOIN public.students s ON s.id = fl.student_id
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
      LEFT JOIN public.campuses cp ON cp.id = s.campus_id
      LEFT JOIN public.courses co ON co.id = s.course_id
      LEFT JOIN public.batches b ON b.id = s.batch_id
      LEFT JOIN public.admission_sessions ase ON ase.id = s.session_id
      WHERE lp.status = 'confirmed'
        AND COALESCE(flp.amount, 0) > 0
        AND (_campus_ids IS NULL OR s.campus_id = ANY (_campus_ids))
        AND (lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date <= v_as_of
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'student_id',            student_id,
             'name',                  name,
             'admission_no',          admission_no,
             'campus_name',           campus_name,
             'course_id',             course_id,
             'course_name',           course_name,
             'batch_name',            batch_name,
             'session_name',          session_name,
             'fee_ledger_id',         fee_ledger_id,
             'fee_code',              fee_code,
             'fee_name',              fee_name,
             'term',                  term,
             'due_amount',            due_amount,
             'collected_amount',      collected_amount,
             'balance',               balance,
             'due_date',              due_date,
             'collected_date',        collected_date,
             'late_fine_due',         late_fine_due,
             'late_fine_collected',   late_fine_collected,
             'is_overdue',            is_overdue,
             'payment_id',            payment_id,
             'receipt_no',            receipt_no,
             'payment_mode',          payment_mode,
             'transaction_ref',       transaction_ref,
             'payment_type',          payment_type,
             'payment_date',          payment_date,
             'fee_ledger_payment_id', fee_ledger_payment_id
           ) ORDER BY payment_date, campus_name, course_name, batch_name, name, receipt_no, fee_name), '[]'::jsonb)
      INTO v_lines
      FROM collected_lines;

    RETURN jsonb_build_object(
      'as_of', v_as_of,
      'scope', v_scope,
      'lines', COALESCE(v_lines, '[]'::jsonb)
    );
  END IF;

  WITH collected AS (
    SELECT
      flp.fee_ledger_id,
      MAX((lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date) AS collected_date
    FROM public.fee_ledger_payments flp
    JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
    JOIN public.fee_ledger flc ON flc.id = flp.fee_ledger_id
    JOIN public.students sc ON sc.id = flc.student_id
    WHERE lp.status = 'confirmed'
      AND (_campus_ids IS NULL OR sc.campus_id = ANY (_campus_ids))
    GROUP BY flp.fee_ledger_id
  ),
  late AS (
    SELECT
      lf.student_id,
      lf.term,
      SUM(lf.total_amount - lf.concession) AS late_due,
      SUM(lf.paid_amount) AS late_collected
    FROM public.fee_ledger lf
    JOIN public.fee_codes lfc ON lfc.id = lf.fee_code_id AND lfc.code = 'LATE-FEE'
    JOIN public.students sl ON sl.id = lf.student_id
    WHERE (_campus_ids IS NULL OR sl.campus_id = ANY (_campus_ids))
    GROUP BY lf.student_id, lf.term
  ),
  parent_lines AS (
    SELECT
      fl.student_id,
      s.name,
      s.admission_no,
      cp.name AS campus_name,
      co.id AS course_id,
      co.name AS course_name,
      b.name AS batch_name,
      ase.name AS session_name,
      fl.id AS fee_ledger_id,
      fc.code AS fee_code,
      fc.name AS fee_name,
      fl.term,
      (fl.total_amount - fl.concession) AS due_amount,
      fl.paid_amount AS collected_amount,
      fl.balance,
      fl.due_date,
      c.collected_date,
      COALESCE(late.late_due, 0) AS late_due_raw,
      COALESCE(late.late_collected, 0) AS late_collected_raw,
      (fl.due_date IS NOT NULL AND fl.due_date < v_as_of AND fl.balance > 0) AS is_overdue,
      ROW_NUMBER() OVER (
        PARTITION BY fl.student_id, fl.term
        ORDER BY fl.due_date NULLS LAST, fc.name, fl.id
      ) AS term_rn
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
    LEFT JOIN public.campuses cp ON cp.id = s.campus_id
    LEFT JOIN public.courses co ON co.id = s.course_id
    LEFT JOIN public.batches b ON b.id = s.batch_id
    LEFT JOIN public.admission_sessions ase ON ase.id = s.session_id
    LEFT JOIN collected c ON c.fee_ledger_id = fl.id
    LEFT JOIN late ON late.student_id = fl.student_id
                  AND late.term = ('late_' || fl.term)
    WHERE (_campus_ids IS NULL OR s.campus_id = ANY (_campus_ids))
      AND fc.code IS DISTINCT FROM 'LATE-FEE'
      AND COALESCE(fl.term, '') NOT LIKE 'late!_%' ESCAPE '!'
      AND (
        v_scope = 'entire_batch'
        OR (v_scope = 'till_date' AND (fl.due_date IS NULL OR fl.due_date <= v_as_of))
        OR (v_scope = 'overdue' AND fl.due_date IS NOT NULL AND fl.due_date < v_as_of AND fl.balance > 0)
      )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id',          student_id,
           'name',                name,
           'admission_no',        admission_no,
           'campus_name',         campus_name,
           'course_id',           course_id,
           'course_name',         course_name,
           'batch_name',          batch_name,
           'session_name',        session_name,
           'fee_ledger_id',       fee_ledger_id,
           'fee_code',            fee_code,
           'fee_name',            fee_name,
           'term',                term,
           'due_amount',          due_amount,
           'collected_amount',    collected_amount,
           'balance',             balance,
           'due_date',            due_date,
           'collected_date',      collected_date,
           'late_fine_due',       CASE WHEN term_rn = 1 THEN late_due_raw ELSE 0 END,
           'late_fine_collected', CASE WHEN term_rn = 1 THEN late_collected_raw ELSE 0 END,
           'is_overdue',          is_overdue
         ) ORDER BY campus_name, course_name, batch_name, name, due_date, fee_name, term), '[]'::jsonb)
    INTO v_lines
    FROM parent_lines;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'scope', v_scope,
    'lines', COALESCE(v_lines, '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fee_collection_vs_due_report(uuid[], text, date)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
