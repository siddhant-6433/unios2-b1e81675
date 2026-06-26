-- Student/course-scoped library borrowing and library fine ledger integration.

CREATE TABLE IF NOT EXISTS public.library_branch_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.library_branches(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_library_branch_courses_branch_active
  ON public.library_branch_courses(branch_id, active);
CREATE INDEX IF NOT EXISTS idx_library_branch_courses_course_active
  ON public.library_branch_courses(course_id, active);

DROP TRIGGER IF EXISTS trg_library_branch_courses_updated_at ON public.library_branch_courses;
CREATE TRIGGER trg_library_branch_courses_updated_at
  BEFORE UPDATE ON public.library_branch_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.library_members
  ADD COLUMN IF NOT EXISTS admission_no text,
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_members_admission_no_unique
  ON public.library_members(admission_no)
  WHERE admission_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_members_institution_status
  ON public.library_members(institution_id, status);

ALTER TABLE public.library_fines
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.library_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fee_ledger_id uuid REFERENCES public.fee_ledger(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_fines_loan_unique
  ON public.library_fines(loan_id)
  WHERE loan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_fines_student_status
  ON public.library_fines(student_id, status);
CREATE INDEX IF NOT EXISTS idx_library_fines_fee_ledger
  ON public.library_fines(fee_ledger_id)
  WHERE fee_ledger_id IS NOT NULL;

INSERT INTO public.fee_codes (code, name, category, is_recurring)
VALUES ('LIB-FINE', 'Library Fine', 'library', false)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    is_recurring = EXCLUDED.is_recurring;

INSERT INTO public.library_branch_courses (branch_id, course_id)
SELECT b.id, c.id
FROM public.library_branches b
JOIN public.departments d ON d.institution_id = b.institution_id
JOIN public.courses c ON c.department_id = d.id
ON CONFLICT (branch_id, course_id) DO NOTHING;

CREATE OR REPLACE VIEW public.library_branch_student_members AS
SELECT
  b.id AS branch_id,
  b.name AS library_name,
  b.institution_id,
  s.id AS student_id,
  s.admission_no,
  s.name AS student_name,
  s.phone,
  s.email,
  s.campus_id,
  s.course_id,
  c.name AS course_name,
  c.code AS course_code
FROM public.library_branches b
JOIN public.library_branch_courses lbc
  ON lbc.branch_id = b.id
 AND lbc.active
JOIN public.students s
  ON s.course_id = lbc.course_id
 AND s.campus_id = b.campus_id
 AND s.status = 'active'
 AND s.admission_no IS NOT NULL
JOIN public.courses c ON c.id = s.course_id
WHERE b.active;

CREATE OR REPLACE FUNCTION public.library_course_belongs_to_institution(_course_id uuid, _institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.courses c
    JOIN public.departments d ON d.id = c.department_id
    WHERE c.id = _course_id
      AND d.institution_id = _institution_id
  )
$$;

CREATE OR REPLACE FUNCTION public.library_student_can_borrow_from_branch(_student_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.library_branches b ON b.id = _branch_id
    JOIN public.library_branch_courses lbc
      ON lbc.branch_id = b.id
     AND lbc.course_id = s.course_id
     AND lbc.active
    JOIN public.courses c ON c.id = s.course_id
    JOIN public.departments d ON d.id = c.department_id
    WHERE s.id = _student_id
      AND s.status = 'active'
      AND s.admission_no IS NOT NULL
      AND s.campus_id = b.campus_id
      AND d.institution_id = b.institution_id
  )
$$;

CREATE OR REPLACE FUNCTION public.library_student_has_unpaid_dues(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.library_fines lf
      WHERE lf.student_id = _student_id
        AND lf.status = 'unpaid'
        AND lf.amount > 0
    )
    OR EXISTS (
      SELECT 1
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
      WHERE fl.student_id = _student_id
        AND fc.code = 'LIB-FINE'
        AND fl.balance > 0
        AND fl.status <> 'paid'
    )
$$;

CREATE OR REPLACE FUNCTION public.library_get_or_create_student_member(_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_institution_id uuid;
  v_member_id uuid;
BEGIN
  SELECT * INTO v_student
  FROM public.students
  WHERE id = _student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Student not found';
  END IF;
  IF v_student.admission_no IS NULL THEN
    RAISE EXCEPTION 'Student must have an admission number before borrowing books';
  END IF;

  SELECT d.institution_id INTO v_institution_id
  FROM public.courses c
  JOIN public.departments d ON d.id = c.department_id
  WHERE c.id = v_student.course_id;

  INSERT INTO public.library_members (
    student_id,
    user_id,
    member_type,
    display_name,
    phone,
    email,
    campus_id,
    institution_id,
    admission_no,
    status,
    borrowing_limit
  )
  VALUES (
    v_student.id,
    v_student.user_id,
    'student',
    v_student.name,
    v_student.phone,
    v_student.email,
    v_student.campus_id,
    v_institution_id,
    v_student.admission_no,
    'active',
    3
  )
  ON CONFLICT (student_id) WHERE student_id IS NOT NULL
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    display_name = EXCLUDED.display_name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    campus_id = EXCLUDED.campus_id,
    institution_id = EXCLUDED.institution_id,
    admission_no = EXCLUDED.admission_no,
    updated_at = now()
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_validate_loan_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_student_id uuid;
  v_member_status text;
  v_member_type text;
  v_borrowing_limit int;
  v_active_loan_count int;
BEGIN
  IF NEW.status NOT IN ('active', 'overdue') THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.library_items
  WHERE id = NEW.item_id;

  SELECT student_id, status, member_type
    INTO v_student_id, v_member_status, v_member_type
  FROM public.library_members
  WHERE id = NEW.member_id;

  IF v_member_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Library member is blocked or inactive';
  END IF;

  IF v_member_type = 'student' THEN
    IF v_student_id IS NULL THEN
      RAISE EXCEPTION 'Student loans must be linked to a student admission record';
    END IF;
    IF NOT public.library_student_can_borrow_from_branch(v_student_id, v_branch_id) THEN
      RAISE EXCEPTION 'Student does not belong to a course enabled for this library';
    END IF;
    IF public.library_student_has_unpaid_dues(v_student_id) THEN
      RAISE EXCEPTION 'Student has unpaid library dues and cannot borrow more books';
    END IF;

    SELECT COALESCE(ls.borrowing_limit, m.borrowing_limit, 3)
      INTO v_borrowing_limit
    FROM public.library_members m
    LEFT JOIN public.library_settings ls ON ls.branch_id = v_branch_id
    WHERE m.id = NEW.member_id;

    SELECT COUNT(*) INTO v_active_loan_count
    FROM public.library_loans
    WHERE member_id = NEW.member_id
      AND status IN ('active', 'overdue');

    IF v_active_loan_count >= COALESCE(v_borrowing_limit, 3) THEN
      RAISE EXCEPTION 'Student has reached the active book borrowing limit for this library';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_library_validate_loan_issue ON public.library_loans;
CREATE TRIGGER trg_library_validate_loan_issue
  BEFORE INSERT ON public.library_loans
  FOR EACH ROW EXECUTE FUNCTION public.library_validate_loan_issue();

CREATE OR REPLACE FUNCTION public.library_assess_loan_fine(_loan_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loan public.library_loans%ROWTYPE;
  v_item public.library_items%ROWTYPE;
  v_member public.library_members%ROWTYPE;
  v_fine_per_day numeric(10,2);
  v_days_overdue int;
  v_amount numeric(10,2);
  v_fine_id uuid;
  v_fee_code_id uuid;
  v_fee_ledger_id uuid;
BEGIN
  SELECT * INTO v_loan FROM public.library_loans WHERE id = _loan_id;
  IF v_loan.id IS NULL THEN
    RAISE EXCEPTION 'Library loan not found';
  END IF;

  SELECT * INTO v_item FROM public.library_items WHERE id = v_loan.item_id;
  SELECT * INTO v_member FROM public.library_members WHERE id = v_loan.member_id;

  v_days_overdue := GREATEST((COALESCE(v_loan.returned_at::date, current_date) - v_loan.due_on), 0);
  IF v_days_overdue = 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(fine_per_day, 0) INTO v_fine_per_day
  FROM public.library_settings
  WHERE branch_id = v_item.branch_id;

  v_fine_per_day := COALESCE(v_fine_per_day, 0);
  v_amount := ROUND((v_days_overdue * v_fine_per_day)::numeric, 2);
  IF v_amount <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.library_fines (
    loan_id,
    member_id,
    student_id,
    branch_id,
    amount,
    reason,
    status,
    assessed_at,
    notes
  )
  VALUES (
    v_loan.id,
    v_loan.member_id,
    v_member.student_id,
    v_item.branch_id,
    v_amount,
    'overdue',
    'unpaid',
    now(),
    format('%s day(s) overdue at %s per day', v_days_overdue, v_fine_per_day)
  )
  ON CONFLICT (loan_id) WHERE loan_id IS NOT NULL
  DO UPDATE SET
    amount = EXCLUDED.amount,
    student_id = EXCLUDED.student_id,
    branch_id = EXCLUDED.branch_id,
    status = CASE WHEN public.library_fines.status = 'paid' THEN 'paid' ELSE 'unpaid' END,
    assessed_at = now(),
    notes = EXCLUDED.notes
  RETURNING id, fee_ledger_id INTO v_fine_id, v_fee_ledger_id;

  IF v_member.student_id IS NOT NULL THEN
    SELECT id INTO v_fee_code_id FROM public.fee_codes WHERE code = 'LIB-FINE';

    IF v_fee_ledger_id IS NULL THEN
      INSERT INTO public.fee_ledger (
        student_id,
        fee_code_id,
        term,
        total_amount,
        concession,
        paid_amount,
        due_date,
        status
      )
      VALUES (
        v_member.student_id,
        v_fee_code_id,
        'library_fine',
        v_amount,
        0,
        0,
        current_date,
        'due'
      )
      RETURNING id INTO v_fee_ledger_id;

      UPDATE public.library_fines
      SET fee_ledger_id = v_fee_ledger_id
      WHERE id = v_fine_id;
    ELSE
      UPDATE public.fee_ledger
      SET total_amount = v_amount,
          due_date = current_date,
          status = CASE WHEN balance <= 0 THEN 'paid' ELSE 'due' END,
          updated_at = now()
      WHERE id = v_fee_ledger_id;
    END IF;
  END IF;

  RETURN v_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_sync_fine_from_fee_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT code INTO v_code FROM public.fee_codes WHERE id = NEW.fee_code_id;
  IF v_code = 'LIB-FINE' AND NEW.balance <= 0 THEN
    UPDATE public.library_fines
    SET status = 'paid',
        resolved_at = COALESCE(resolved_at, now())
    WHERE fee_ledger_id = NEW.id
      AND status = 'unpaid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_library_sync_fine_from_fee_ledger ON public.fee_ledger;
CREATE TRIGGER trg_library_sync_fine_from_fee_ledger
  AFTER UPDATE OF paid_amount, concession, total_amount, status ON public.fee_ledger
  FOR EACH ROW EXECUTE FUNCTION public.library_sync_fine_from_fee_ledger();

CREATE OR REPLACE FUNCTION public.library_issue_by_admission_no(
  _branch_id uuid,
  _accession_or_barcode text,
  _admission_no text,
  _due_on date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
  v_member_id uuid;
  v_item_id uuid;
  v_due_on date;
  v_loan_id uuid;
  v_settings public.library_settings%ROWTYPE;
BEGIN
  IF NOT public.library_user_can_access_branch(auth.uid(), _branch_id, 'circulate') THEN
    RAISE EXCEPTION 'You do not have circulation access to this library';
  END IF;

  SELECT id INTO v_student_id
  FROM public.students
  WHERE admission_no = trim(_admission_no)
    AND status = 'active';

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Active student not found for admission number %', _admission_no;
  END IF;

  IF NOT public.library_student_can_borrow_from_branch(v_student_id, _branch_id) THEN
    RAISE EXCEPTION 'Student does not belong to a course enabled for this library';
  END IF;
  IF public.library_student_has_unpaid_dues(v_student_id) THEN
    RAISE EXCEPTION 'Student has unpaid library dues and cannot borrow more books';
  END IF;

  SELECT id INTO v_item_id
  FROM public.library_items
  WHERE branch_id = _branch_id
    AND (accession_no = trim(_accession_or_barcode) OR barcode = trim(_accession_or_barcode))
    AND status IN ('available', 'reserved')
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'No available copy found for that accession or barcode in this library';
  END IF;

  SELECT * INTO v_settings FROM public.library_settings WHERE branch_id = _branch_id;
  v_due_on := COALESCE(_due_on, current_date + COALESCE(v_settings.borrowing_days, 14));

  v_member_id := public.library_get_or_create_student_member(v_student_id);

  INSERT INTO public.library_loans (
    item_id,
    member_id,
    issued_by,
    due_on,
    status
  )
  VALUES (
    v_item_id,
    v_member_id,
    auth.uid(),
    v_due_on,
    'active'
  )
  RETURNING id INTO v_loan_id;

  RETURN v_loan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_return_by_accession(
  _branch_id uuid,
  _accession_or_barcode text
)
RETURNS TABLE (loan_id uuid, fine_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loan_id uuid;
  v_fine numeric;
BEGIN
  IF NOT public.library_user_can_access_branch(auth.uid(), _branch_id, 'circulate') THEN
    RAISE EXCEPTION 'You do not have circulation access to this library';
  END IF;

  SELECT l.id INTO v_loan_id
  FROM public.library_loans l
  JOIN public.library_items i ON i.id = l.item_id
  WHERE i.branch_id = _branch_id
    AND (i.accession_no = trim(_accession_or_barcode) OR i.barcode = trim(_accession_or_barcode))
    AND l.status IN ('active', 'overdue')
  ORDER BY l.issued_at DESC
  LIMIT 1;

  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'No active loan found for that accession or barcode in this library';
  END IF;

  UPDATE public.library_loans
  SET status = 'returned',
      returned_at = now(),
      returned_by = auth.uid(),
      updated_at = now()
  WHERE id = v_loan_id;

  v_fine := public.library_assess_loan_fine(v_loan_id);

  RETURN QUERY SELECT v_loan_id, v_fine;
END;
$$;

ALTER TABLE public.library_branch_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users view library branch courses" ON public.library_branch_courses;
CREATE POLICY "Authenticated users view library branch courses" ON public.library_branch_courses
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Library managers maintain branch courses" ON public.library_branch_courses;
CREATE POLICY "Library managers maintain branch courses" ON public.library_branch_courses
  FOR ALL TO authenticated
  USING (public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings'))
  WITH CHECK (
    public.library_user_can_access_branch(auth.uid(), branch_id, 'manage_settings')
    AND public.library_course_belongs_to_institution(
      course_id,
      (SELECT institution_id FROM public.library_branches WHERE id = branch_id)
    )
  );

DROP POLICY IF EXISTS "Library staff can view students for circulation" ON public.students;
CREATE POLICY "Library staff can view students for circulation" ON public.students
  FOR SELECT TO authenticated
  USING (
    public.library_user_has_any_assignment(auth.uid(), 'circulate')
    OR public.library_user_has_any_assignment(auth.uid(), 'manage_settings')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_branch_courses TO authenticated;
GRANT ALL ON public.library_branch_courses TO service_role;
GRANT SELECT ON public.library_branch_student_members TO authenticated;

GRANT EXECUTE ON FUNCTION public.library_course_belongs_to_institution(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_student_can_borrow_from_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_student_has_unpaid_dues(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_get_or_create_student_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_assess_loan_fine(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_issue_by_admission_no(uuid, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_return_by_accession(uuid, text) TO authenticated;
