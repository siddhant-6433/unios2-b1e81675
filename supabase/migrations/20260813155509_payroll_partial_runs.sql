-- Partial payroll runs: pay part of the organisation at a time.
--
-- NIMT wants to run teaching staff, non-teaching staff or one campus separately
-- rather than the whole payroll in one go. That means several cycles can cover the
-- same month, which removes the constraint that used to guarantee an employee
-- appeared only once per month.
--
-- So the safety property has to be re-established explicitly, and it is the important
-- part of this migration: NOBODY IS PAID TWICE FOR OVERLAPPING DATES. Without it, a
-- "teaching staff" run followed by an "everyone" run pays the teachers twice.

-- One run per month per entity is no longer the rule.
ALTER TABLE public.payroll_cycles
  DROP CONSTRAINT IF EXISTS payroll_cycles_legal_entity_id_period_start_key;

-- Runs covering the same month need to be tellable apart.
ALTER TABLE public.payroll_cycles
  ADD COLUMN IF NOT EXISTS name text;

CREATE INDEX IF NOT EXISTS payroll_cycles_period_idx
  ON public.payroll_cycles (legal_entity_id, period_start, period_end);

-- ── The double-pay guard ───────────────────────────────────────────────
-- An employee may appear only once across all cycles of one legal entity whose
-- periods overlap. Enforced in the database because the UI is not the only writer:
-- populate_payroll_cycle, manual inserts and future imports all pass through here.
CREATE OR REPLACE FUNCTION public.guard_duplicate_payroll_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cycle    public.payroll_cycles;
  v_clash    text;
BEGIN
  SELECT * INTO v_cycle FROM public.payroll_cycles WHERE id = NEW.payroll_cycle_id;

  SELECT COALESCE(c.name, to_char(c.period_start, 'Mon YYYY')) INTO v_clash
    FROM public.payroll_lines l
    JOIN public.payroll_cycles c ON c.id = l.payroll_cycle_id
   WHERE l.employee_profile_id = NEW.employee_profile_id
     AND l.id IS DISTINCT FROM NEW.id
     AND c.id <> v_cycle.id
     AND c.legal_entity_id = v_cycle.legal_entity_id
     -- Standard half-open overlap test.
     AND c.period_start <= v_cycle.period_end
     AND c.period_end   >= v_cycle.period_start
   LIMIT 1;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION
      'Employee is already on payroll run "%" for overlapping dates - they would be paid twice',
      v_clash;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payroll_lines_duplicate_guard ON public.payroll_lines;
CREATE TRIGGER payroll_lines_duplicate_guard
  BEFORE INSERT OR UPDATE OF employee_profile_id, payroll_cycle_id ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_duplicate_payroll_line();

REVOKE ALL ON FUNCTION public.guard_duplicate_payroll_line() FROM PUBLIC;

-- ── Populate a run with a filtered subset ──────────────────────────────
-- All filters are optional; NULL means "no restriction". Employees already covered by
-- an overlapping run are skipped silently rather than raising, so "load the rest of
-- the staff" is a safe second click.
CREATE OR REPLACE FUNCTION public.populate_payroll_cycle(
  _cycle_id       uuid,
  _department_ids uuid[] DEFAULT NULL,
  _campus_ids     uuid[] DEFAULT NULL,
  _worker_types   text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle  public.payroll_cycles;
  v_added  integer := 0;
BEGIN
  SELECT * INTO v_cycle FROM public.payroll_cycles WHERE id = _cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll cycle not found'; END IF;
  IF v_cycle.status IN ('locked', 'paid') THEN
    RAISE EXCEPTION 'Payroll cycle is %', v_cycle.status;
  END IF;

  IF NOT (public.has_permission(auth.uid(), 'hr:payroll_run')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  INSERT INTO public.payroll_lines (
    payroll_cycle_id, employee_profile_id, employee_name, employee_number,
    designation, monthly_gross, total_days, payable_days
  )
  SELECT
    _cycle_id,
    e.id,
    COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)),
    e.employee_number,
    e.job_title,
    COALESCE(s.monthly_gross, 0),
    (v_cycle.period_end - v_cycle.period_start) + 1,
    (LEAST(COALESCE(e.date_of_exit, v_cycle.period_end), v_cycle.period_end)
     - GREATEST(COALESCE(e.date_of_joining, v_cycle.period_start), v_cycle.period_start)) + 1
  FROM public.employee_profiles e
  LEFT JOIN LATERAL (
    SELECT es.monthly_gross
      FROM public.employee_salaries es
     WHERE es.employee_profile_id = e.id
       AND es.effective_from <= v_cycle.period_end
       AND (es.effective_to IS NULL OR es.effective_to >= v_cycle.period_start)
     ORDER BY es.effective_from DESC
     LIMIT 1
  ) s ON true
  WHERE e.verification_status = 'verified'
    AND e.legal_entity_id = v_cycle.legal_entity_id
    AND (e.date_of_joining IS NULL OR e.date_of_joining <= v_cycle.period_end)
    AND (e.date_of_exit IS NULL OR e.date_of_exit >= v_cycle.period_start)
    AND (e.employment_status IS NULL
         OR e.employment_status IN ('Working', 'On Notice')
         OR e.date_of_exit IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = e.user_id
         AND ur.role::text IN ('student','parent','consultant','academic_partner',
                               'academic_partner_offer_letter','publisher')
    )
    -- Subset filters for a partial run.
    AND (_department_ids IS NULL OR e.department_id = ANY(_department_ids))
    AND (_campus_ids     IS NULL OR e.campus_id     = ANY(_campus_ids))
    AND (_worker_types   IS NULL OR e.worker_type   = ANY(_worker_types))
    -- Already covered by another run for overlapping dates.
    AND NOT EXISTS (
      SELECT 1
        FROM public.payroll_lines pl
        JOIN public.payroll_cycles pc ON pc.id = pl.payroll_cycle_id
       WHERE pl.employee_profile_id = e.id
         AND pc.id <> _cycle_id
         AND pc.legal_entity_id = v_cycle.legal_entity_id
         AND pc.period_start <= v_cycle.period_end
         AND pc.period_end   >= v_cycle.period_start
    )
  ON CONFLICT (payroll_cycle_id, employee_profile_id) DO NOTHING;

  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$$;

GRANT EXECUTE ON FUNCTION public.populate_payroll_cycle(uuid, uuid[], uuid[], text[]) TO authenticated;

-- The old single-argument signature would otherwise linger as an overload that
-- silently bypasses the new filters.
DROP FUNCTION IF EXISTS public.populate_payroll_cycle(uuid);

-- ── Who is still unpaid this month ─────────────────────────────────────
-- Answers "did we miss anyone across all the partial runs?", which is the question
-- partial payroll makes easy to get wrong.
CREATE OR REPLACE FUNCTION public.payroll_uncovered_employees(
  _legal_entity_id uuid,
  _period_start    date,
  _period_end      date
)
RETURNS TABLE (
  employee_profile_id uuid,
  employee_name       text,
  employee_number     text,
  designation         text,
  department_id       uuid,
  campus_id           uuid,
  worker_type         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id,
         COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)),
         e.employee_number, e.job_title, e.department_id, e.campus_id, e.worker_type
    FROM public.employee_profiles e
   WHERE public.has_permission(auth.uid(), 'hr:payroll_run')
     AND e.verification_status = 'verified'
     AND e.legal_entity_id = _legal_entity_id
     AND (e.date_of_joining IS NULL OR e.date_of_joining <= _period_end)
     AND (e.date_of_exit IS NULL OR e.date_of_exit >= _period_start)
     AND (e.employment_status IS NULL
          OR e.employment_status IN ('Working', 'On Notice')
          OR e.date_of_exit IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = e.user_id
          AND ur.role::text IN ('student','parent','consultant','academic_partner',
                                'academic_partner_offer_letter','publisher')
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.payroll_lines pl
         JOIN public.payroll_cycles pc ON pc.id = pl.payroll_cycle_id
        WHERE pl.employee_profile_id = e.id
          AND pc.legal_entity_id = _legal_entity_id
          AND pc.period_start <= _period_end
          AND pc.period_end   >= _period_start
     )
   ORDER BY 2;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_uncovered_employees(uuid, date, date) TO authenticated;
