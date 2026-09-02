-- Two read-only RPCs feed surfaces that label fee collection terms, and
-- neither returned the course. Without it the caller cannot resolve the
-- programme's active fee_structures.metadata (period_label / year_N.label),
-- which is the only thing that knows D.AOTT's year_1..year_5 terms are really
-- 5 semesters — so both surfaces always printed "Year N".
--
-- Both changes are additive: existing columns/keys keep their names and types.

-- 1. get_applicant_lead_info — the applicant fee breakdown labels each term ("Year 1 Fee").
-- Which word is right — Year or Semester — is declared by the programme's
-- active fee_structures.metadata (period_label / year_N.label), because a
-- semester programme like D.AOTT still stores its 5 semesters under the
-- terms year_1..year_5. Resolving that structure needs the lead's course,
-- which this applicant-safe RPC did not return, so the portal had no way to
-- know and always said "Year".
DROP FUNCTION IF EXISTS public.get_applicant_lead_info(uuid);

CREATE OR REPLACE FUNCTION public.get_applicant_lead_info(_lead_id uuid)
RETURNS TABLE(
  id uuid,
  stage text,
  session_id uuid,
  pre_admission_no text,
  admission_no text,
  phone text,
  email text,
  course_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.stage::text,
    l.session_id,
    l.pre_admission_no,
    l.admission_no,
    l.phone,
    l.email,
    l.course_id
  FROM public.leads l
  WHERE l.id = _lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_lead_info(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.get_applicant_lead_info(uuid) IS
  'Applicant-safe lead fields for TokenFeePanel (phone/email for gateway prefill, course_id to resolve fee-structure period labels).';


-- 2. fee_due_default_report — the Fee Due / Default report labels the term of
-- every ledger line and exports it to CSV.

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
      co.id          AS course_id,
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
    GROUP BY fl.student_id, s.name, s.admission_no, cp.name, co.id, co.name, b.name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id',       student_id,
           'name',             name,
           'admission_no',     admission_no,
           'campus_name',      campus_name,
           'course_id',        course_id,
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
           'course_id',     co.id,
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
