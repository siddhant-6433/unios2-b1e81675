-- Fee Due & Fee Default report — per-student and per-fee-head outstanding view.
--
-- Aggregates public.fee_ledger server-side and returns it as a single jsonb
-- value. Two reasons this MUST be a DEFINER RPC returning jsonb rather than a
-- client select:
--   1. fee_ledger/students are staff-scoped via per-row RLS; aggregating them
--      per-student needs an unfiltered read.
--   2. A client .from('fee_ledger').select() is silently capped at 1000 rows,
--      so a ~2,800-student report would under-count. jsonb is not row-capped.
--
-- Balance is the authoritative generated column (total_amount - concession -
-- paid_amount). "Overdue" here is DATE-DRIVEN: due_date < today AND balance > 0
-- (independent of the late-fee cron's status='overdue', which lags and carries a
-- grace period), so the report is truthful the moment a due date passes.
--
-- ponytail: `lines` returns every fee head for every student in one payload
-- (~a few tens of thousands of rows of jsonb at current scale — fine). If it
-- ever gets heavy, split the line detail into a second campus-scoped RPC.

CREATE OR REPLACE FUNCTION public.fee_due_report(_campus_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_students jsonb;
  v_lines    jsonb;
BEGIN
  -- Gate: same finance-view access the /finance route requires. DEFINER
  -- bypasses RLS, so authorize explicitly here.
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_permission(auth.uid(), 'finance:view')
  ) THEN
    RETURN jsonb_build_object('as_of', CURRENT_DATE, 'students', '[]'::jsonb, 'lines', '[]'::jsonb);
  END IF;

  -- Per-student summary (one row per student that has any ledger row, including
  -- fully-paid ones so "paid vs not paid" is visible).
  WITH agg AS (
    SELECT
      fl.student_id,
      s.name         AS name,
      s.admission_no AS admission_no,
      cp.name        AS campus_name,
      co.name        AS course_name,
      b.name         AS batch_name,
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
    WHERE (_campus_ids IS NULL OR s.campus_id = ANY (_campus_ids))
    GROUP BY fl.student_id, s.name, s.admission_no, cp.name, co.name, b.name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id',       student_id,
           'name',             name,
           'admission_no',     admission_no,
           'campus_name',      campus_name,
           'course_name',      course_name,
           'batch_name',       batch_name,
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

  -- Per-fee-head line detail.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id',    fl.student_id,
           'name',          s.name,
           'admission_no',  s.admission_no,
           'campus_name',   cp.name,
           'course_name',   co.name,
           'batch_name',    b.name,
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
    WHERE (_campus_ids IS NULL OR s.campus_id = ANY (_campus_ids));

  RETURN jsonb_build_object(
    'as_of',    CURRENT_DATE,
    'students', v_students,
    'lines',    v_lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fee_due_report(uuid[]) TO authenticated, service_role;
