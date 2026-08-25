-- Add session_name to fee_due_report (both students + lines) so the Fee Dues
-- report can offer a Session filter. Session is populated on ~all students
-- (batch_id is not), so it's the grouping finance can actually use today.
-- Joins admission_sessions on students.session_id.

CREATE OR REPLACE FUNCTION public.fee_due_report(_campus_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_students jsonb;
  v_lines    jsonb;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_permission(auth.uid(), 'finance:view')
  ) THEN
    RETURN jsonb_build_object('as_of', CURRENT_DATE, 'students', '[]'::jsonb, 'lines', '[]'::jsonb);
  END IF;

  WITH agg AS (
    SELECT
      fl.student_id,
      s.name         AS name,
      s.admission_no AS admission_no,
      cp.name        AS campus_name,
      co.name        AS course_name,
      b.name         AS batch_name,
      ase.name       AS session_name,
      SUM(fl.total_amount - fl.concession)                                      AS total_charged,
      SUM(fl.paid_amount)                                                       AS total_paid,
      SUM(fl.concession)                                                        AS total_concession,
      SUM(fl.balance)                                                           AS balance,
      COALESCE(SUM(fl.balance) FILTER (WHERE fl.due_date < CURRENT_DATE AND fl.balance > 0), 0) AS overdue_amount,
      MIN(fl.due_date) FILTER (WHERE fl.balance > 0)                            AS next_due_date,
      MIN(fl.due_date) FILTER (WHERE fl.due_date < CURRENT_DATE AND fl.balance > 0) AS earliest_overdue_date
    FROM public.fee_ledger fl
    JOIN public.students s  ON s.id = fl.student_id
    LEFT JOIN public.campuses cp ON cp.id = s.campus_id
    LEFT JOIN public.courses  co ON co.id = s.course_id
    LEFT JOIN public.batches  b  ON b.id = s.batch_id
    LEFT JOIN public.admission_sessions ase ON ase.id = s.session_id
    WHERE (_campus_ids IS NULL OR s.campus_id = ANY (_campus_ids))
    GROUP BY fl.student_id, s.name, s.admission_no, cp.name, co.name, b.name, ase.name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id',       student_id,
           'name',             name,
           'admission_no',     admission_no,
           'campus_name',      campus_name,
           'course_name',      course_name,
           'batch_name',       batch_name,
           'session_name',     session_name,
           'total_charged',    total_charged,
           'total_paid',       total_paid,
           'total_concession', total_concession,
           'balance',          balance,
           'overdue_amount',   overdue_amount,
           'next_due_date',    next_due_date,
           'earliest_overdue_date', earliest_overdue_date,
           'days_overdue',     CASE WHEN earliest_overdue_date IS NOT NULL
                                    THEN (CURRENT_DATE - earliest_overdue_date) ELSE 0 END,
           'fully_paid',       (balance <= 0)
         ) ORDER BY overdue_amount DESC, balance DESC, name), '[]'::jsonb)
    INTO v_students
    FROM agg;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id',    fl.student_id,
           'name',          s.name,
           'admission_no',  s.admission_no,
           'campus_name',   cp.name,
           'course_name',   co.name,
           'batch_name',    b.name,
           'session_name',  ase.name,
           'fee_code',      fc.code,
           'fee_name',      fc.name,
           'term',          fl.term,
           'total_amount',  fl.total_amount,
           'concession',    fl.concession,
           'paid_amount',   fl.paid_amount,
           'balance',       fl.balance,
           'due_date',      fl.due_date,
           'days_overdue',  CASE WHEN fl.due_date < CURRENT_DATE AND fl.balance > 0
                                 THEN (CURRENT_DATE - fl.due_date) ELSE 0 END,
           'is_overdue',    (fl.due_date < CURRENT_DATE AND fl.balance > 0)
         ) ORDER BY (fl.due_date < CURRENT_DATE AND fl.balance > 0) DESC, fl.due_date, s.name), '[]'::jsonb)
    INTO v_lines
    FROM public.fee_ledger fl
    JOIN public.students s  ON s.id = fl.student_id
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
    LEFT JOIN public.campuses cp ON cp.id = s.campus_id
    LEFT JOIN public.courses  co ON co.id = s.course_id
    LEFT JOIN public.batches  b  ON b.id = s.batch_id
    LEFT JOIN public.admission_sessions ase ON ase.id = s.session_id
    WHERE (_campus_ids IS NULL OR s.campus_id = ANY (_campus_ids));

  RETURN jsonb_build_object(
    'as_of',    CURRENT_DATE,
    'students', v_students,
    'lines',    v_lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fee_due_report(uuid[]) TO authenticated, service_role;
