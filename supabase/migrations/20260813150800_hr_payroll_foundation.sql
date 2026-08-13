-- Payroll foundation: legal entities, salary structures, effective-dated employee
-- salaries, and monthly payroll cycles that auto-populate from active employees.
--
-- NIMT has run payroll in Excel, maintaining the employee list by hand. The point of
-- this schema is that a cycle derives its own roster from employee_profiles, so nobody
-- retypes 85 names a month.
--
-- Two rules the shape encodes, both learned the hard way in payroll systems:
--   1. Salaries are EFFECTIVE-DATED. A revision must never rewrite a past payslip.
--   2. A payroll line SNAPSHOTS its computed numbers. Once locked it is immutable, and
--      corrections flow through arrears in a later cycle rather than mutating history.

-- ── Legal entities ─────────────────────────────────────────────────────
-- NIMT and Seralis Lab Diagnostics LLP are separate employers. Payslips, letters and
-- statutory filings must name the right one.
CREATE TABLE IF NOT EXISTS public.legal_entities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL UNIQUE,
  legal_name        text,
  pan               text,
  tan               text,
  gstin             text,
  pf_code           text,
  esi_code          text,
  registered_address text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.legal_entities (name, legal_name)
VALUES ('NIMT', 'NIMT B SCHOOL FOUNDATION'),
       ('Seralis Lab Diagnostics LLP', 'SERALIS LAB DIAGNOSTICS LLP')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.legal_entities(id),
  -- employment_status alone cannot answer "were they employed during March?"
  ADD COLUMN IF NOT EXISTS date_of_exit date;

CREATE INDEX IF NOT EXISTS employee_profiles_legal_entity_idx
  ON public.employee_profiles (legal_entity_id);

-- Backfill everyone to NIMT (85 of the 96 in Keka belong to it) so no employee has a
-- NULL entity. This matters more than it looks: a NULL-entity employee matched by
-- every cycle would be paid twice the month both entities run.
UPDATE public.employee_profiles
   SET legal_entity_id = (SELECT id FROM public.legal_entities WHERE name = 'NIMT')
 WHERE legal_entity_id IS NULL;

-- ── Salary components ──────────────────────────────────────────────────
-- Components are DATA. Nothing about Basic/HRA/PF rates belongs in application code —
-- they differ per employer and change by statute.
CREATE TABLE IF NOT EXISTS public.salary_components (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution')),
  -- 'fixed'          → amount as given
  -- 'percent_of'     → percent applied to the component named in `basis_code`
  -- 'balance'        → whatever is left of gross after the other earnings (special allowance)
  -- 'statutory'      → computed by the engine (PF/ESI/PT/LWF), see payroll_statutory_config
  calculation   text NOT NULL CHECK (calculation IN ('fixed', 'percent_of', 'balance', 'statutory')),
  basis_code    text,
  -- Does this component shrink when the employee loses pay days?
  prorates      boolean NOT NULL DEFAULT true,
  taxable       boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A conventional Indian starting set. HR edits these in the UI; they are a starting
-- point, not a commitment — the payroll Excel is the ground truth and will refine them.
INSERT INTO public.salary_components (code, name, kind, calculation, basis_code, prorates, taxable, display_order) VALUES
  ('BASIC',   'Basic',             'earning',   'percent_of', 'GROSS', true,  true,  10),
  ('HRA',     'House Rent Allow.', 'earning',   'percent_of', 'BASIC', true,  true,  20),
  ('CONV',    'Conveyance',        'earning',   'fixed',      NULL,    true,  true,  30),
  ('SPL',     'Special Allowance', 'earning',   'balance',    NULL,    true,  true,  90),
  ('PF_EE',   'Provident Fund',    'deduction', 'statutory',  NULL,    false, false, 110),
  ('ESI_EE',  'ESI',               'deduction', 'statutory',  NULL,    false, false, 120),
  ('PT',      'Professional Tax',  'deduction', 'statutory',  NULL,    false, false, 130),
  ('LWF_EE',  'Labour Welfare Fund','deduction','statutory',  NULL,    false, false, 140),
  ('PF_ER',   'PF (Employer)',     'employer_contribution', 'statutory', NULL, false, false, 210),
  ('ESI_ER',  'ESI (Employer)',    'employer_contribution', 'statutory', NULL, false, false, 220)
ON CONFLICT (code) DO NOTHING;

-- ── Statutory rates ────────────────────────────────────────────────────
-- Effective-dated so a rate change does not rewrite history. Every rupee and percent
-- lives here, never in code.
CREATE TABLE IF NOT EXISTS public.payroll_statutory_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  key             text NOT NULL,
  numeric_value   numeric(14,4) NOT NULL,
  effective_from  date NOT NULL DEFAULT '2000-01-01',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, key, effective_from)
);

-- Statutory defaults as of 2026 (India). Wage ceilings and rates change — add a new
-- row with a later effective_from rather than editing these.
INSERT INTO public.payroll_statutory_config (legal_entity_id, key, numeric_value, note) VALUES
  (NULL, 'pf_employee_rate',   12.0,    'Percent of PF wage'),
  (NULL, 'pf_employer_rate',   12.0,    'Percent of PF wage'),
  (NULL, 'pf_wage_ceiling',    15000,   'Monthly PF wage ceiling'),
  (NULL, 'esi_employee_rate',  0.75,    'Percent of gross'),
  (NULL, 'esi_employer_rate',  3.25,    'Percent of gross'),
  (NULL, 'esi_wage_ceiling',   21000,   'Gross above this is exempt from ESI'),
  (NULL, 'pt_monthly',         200,     'Professional tax, flat monthly'),
  (NULL, 'lwf_employee',       0,       'Labour welfare fund employee share')
ON CONFLICT DO NOTHING;

-- ── Salary structures ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salary_structures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.salary_structure_components (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_structure_id uuid NOT NULL REFERENCES public.salary_structures(id) ON DELETE CASCADE,
  component_id        uuid NOT NULL REFERENCES public.salary_components(id) ON DELETE RESTRICT,
  -- Meaning depends on the component's `calculation`: a percentage, or a fixed amount.
  value               numeric(14,4) NOT NULL DEFAULT 0,
  UNIQUE (salary_structure_id, component_id)
);

-- ── Employee salaries (effective-dated) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_salaries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  salary_structure_id uuid REFERENCES public.salary_structures(id),
  monthly_gross       numeric(14,2) NOT NULL,
  effective_from      date NOT NULL,
  -- NULL = current. Closed out when a later revision is added.
  effective_to        date,
  revision_note       text,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS employee_salaries_lookup_idx
  ON public.employee_salaries (employee_profile_id, effective_from DESC);

-- Only one open-ended salary per employee; a second would make "current salary" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS employee_salaries_one_current_idx
  ON public.employee_salaries (employee_profile_id)
  WHERE effective_to IS NULL;

-- ── Payroll cycles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_cycles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'processing', 'locked', 'paid')),
  locked_at       timestamptz,
  locked_by       uuid REFERENCES auth.users(id),
  paid_at         timestamptz,
  note            text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, period_start),
  CHECK (period_end >= period_start)
);

-- ── Payroll lines (one per employee per cycle) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_cycle_id    uuid NOT NULL REFERENCES public.payroll_cycles(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE RESTRICT,
  -- Snapshot of who they were and what they earned, so a later profile edit or salary
  -- revision cannot silently change a released payslip.
  employee_name       text,
  employee_number     text,
  designation         text,
  monthly_gross       numeric(14,2) NOT NULL DEFAULT 0,
  payable_days        numeric(6,2) NOT NULL DEFAULT 0,
  total_days          numeric(6,2) NOT NULL DEFAULT 0,
  lop_days            numeric(6,2) NOT NULL DEFAULT 0,
  gross_earnings      numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions    numeric(14,2) NOT NULL DEFAULT 0,
  employer_cost       numeric(14,2) NOT NULL DEFAULT 0,
  net_pay             numeric(14,2) NOT NULL DEFAULT 0,
  -- Free-form additions that do not belong to a structure: bonus, arrears, advances.
  adhoc_earnings      numeric(14,2) NOT NULL DEFAULT 0,
  adhoc_deductions    numeric(14,2) NOT NULL DEFAULT 0,
  on_hold             boolean NOT NULL DEFAULT false,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_cycle_id, employee_profile_id)
);

CREATE INDEX IF NOT EXISTS payroll_lines_cycle_idx ON public.payroll_lines (payroll_cycle_id);

CREATE TABLE IF NOT EXISTS public.payroll_line_components (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_line_id uuid NOT NULL REFERENCES public.payroll_lines(id) ON DELETE CASCADE,
  -- Code and name are copied, not joined: a component renamed next year must not
  -- change what last year's payslip says.
  component_code  text NOT NULL,
  component_name  text NOT NULL,
  kind            text NOT NULL,
  amount          numeric(14,2) NOT NULL DEFAULT 0,
  display_order   integer NOT NULL DEFAULT 0,
  UNIQUE (payroll_line_id, component_code)
);

-- ── Immutability of a locked cycle ─────────────────────────────────────
-- Enforced in the database, not just the UI: a released payslip must stay true.
CREATE OR REPLACE FUNCTION public.guard_locked_payroll()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.payroll_cycles
   WHERE id = COALESCE(NEW.payroll_cycle_id, OLD.payroll_cycle_id);

  IF v_status IN ('locked', 'paid') THEN
    RAISE EXCEPTION 'Payroll cycle is % — reopen it or post an arrears line in a later cycle', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS payroll_lines_locked_guard ON public.payroll_lines;
CREATE TRIGGER payroll_lines_locked_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_payroll();

-- ── Cycle status audit ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_cycle_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_cycle_id uuid NOT NULL,
  from_status      text,
  to_status        text NOT NULL,
  changed_by       uuid,
  changed_at       timestamptz NOT NULL DEFAULT now(),
  totals           jsonb
);

CREATE OR REPLACE FUNCTION public.log_payroll_cycle_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.payroll_cycle_audit (payroll_cycle_id, from_status, to_status, changed_by, totals)
  SELECT NEW.id,
         CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
         NEW.status,
         auth.uid(),
         jsonb_build_object(
           'employees', count(*),
           'gross',     COALESCE(sum(l.gross_earnings), 0),
           'net',       COALESCE(sum(l.net_pay), 0)
         )
    FROM public.payroll_lines l
   WHERE l.payroll_cycle_id = NEW.id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS payroll_cycles_status_audit ON public.payroll_cycles;
CREATE TRIGGER payroll_cycles_status_audit
  AFTER INSERT OR UPDATE ON public.payroll_cycles
  FOR EACH ROW EXECUTE FUNCTION public.log_payroll_cycle_status();

-- ── Auto-populate a cycle from active employees ────────────────────────
-- The whole reason this project exists: nobody retypes the roster.
-- Included when the person was employed for any part of the period.
CREATE OR REPLACE FUNCTION public.populate_payroll_cycle(_cycle_id uuid)
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
    -- Pro-rate a joiner or leaver by the days they were actually employed.
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
    -- Strictly one entity. An employee with no entity is deliberately excluded rather
    -- than matched everywhere; the UI surfaces them so HR assigns one.
    AND e.legal_entity_id = v_cycle.legal_entity_id
    -- Employed during some part of the period.
    AND (e.date_of_joining IS NULL OR e.date_of_joining <= v_cycle.period_end)
    AND (e.date_of_exit IS NULL OR e.date_of_exit >= v_cycle.period_start)
    -- Someone marked Resigned/Terminated with no exit date is genuinely ambiguous;
    -- leave them out rather than guess, and let HR add them by hand.
    AND (e.employment_status IS NULL
         OR e.employment_status IN ('Working', 'On Notice')
         OR e.date_of_exit IS NOT NULL)
    -- Consultants, academic partners, publishers and the like hold logins but are not
    -- on the payroll. Same exclusion list the employee directory uses; an
    -- employee_profiles row pointing at one of them must never be paid.
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = e.user_id
         AND ur.role::text IN ('student','parent','consultant','academic_partner',
                               'academic_partner_offer_letter','publisher')
    )
  ON CONFLICT (payroll_cycle_id, employee_profile_id) DO NOTHING;

  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$$;

-- ── Permission ─────────────────────────────────────────────────────────
-- Separate from hr:employees_edit: editing a profile and releasing money are
-- different privileges.
INSERT INTO public.permissions (module, action, description)
VALUES ('hr', 'payroll_run', 'Run and lock payroll cycles')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE v_perm_id uuid;
BEGIN
  SELECT id INTO v_perm_id FROM public.permissions WHERE module = 'hr' AND action = 'payroll_run';
  INSERT INTO public.role_permissions (role, permission_id)
  VALUES ('campus_admin'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
END $$;

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.legal_entities              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_components           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structure_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_statutory_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_salaries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_cycles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_lines               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_line_components     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_cycle_audit         ENABLE ROW LEVEL SECURITY;

-- Legal entities are reference data every staff screen may need to label a campus.
DROP POLICY IF EXISTS "Authenticated can read legal entities" ON public.legal_entities;
CREATE POLICY "Authenticated can read legal entities"
  ON public.legal_entities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "HR manages legal entities" ON public.legal_entities;
CREATE POLICY "HR manages legal entities"
  ON public.legal_entities FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

-- Everything salary-shaped is payroll-only. Deliberately NO self-service read here:
-- payslip visibility gets its own narrower path when payslips ship.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'salary_components', 'salary_structures', 'salary_structure_components',
    'payroll_statutory_config', 'employee_salaries', 'payroll_cycles',
    'payroll_lines', 'payroll_line_components'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Payroll staff manage %1$s" ON public.%1$I', t);
    EXECUTE format($f$
      CREATE POLICY "Payroll staff manage %1$s" ON public.%1$I FOR ALL TO authenticated
        USING ((SELECT public.has_permission(auth.uid(), 'hr:payroll_run')))
        WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:payroll_run')))
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Payroll staff read cycle audit" ON public.payroll_cycle_audit;
CREATE POLICY "Payroll staff read cycle audit"
  ON public.payroll_cycle_audit FOR SELECT TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:payroll_run')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_entities TO authenticated;
GRANT SELECT ON public.payroll_cycle_audit TO authenticated;
GRANT ALL ON public.legal_entities, public.payroll_cycle_audit TO service_role;

GRANT EXECUTE ON FUNCTION public.populate_payroll_cycle(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.guard_locked_payroll() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_payroll_cycle_status() FROM PUBLIC;

DROP TRIGGER IF EXISTS update_payroll_cycles_updated_at ON public.payroll_cycles;
CREATE TRIGGER update_payroll_cycles_updated_at
  BEFORE UPDATE ON public.payroll_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payroll_lines_updated_at ON public.payroll_lines;
CREATE TRIGGER update_payroll_lines_updated_at
  BEFORE UPDATE ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
