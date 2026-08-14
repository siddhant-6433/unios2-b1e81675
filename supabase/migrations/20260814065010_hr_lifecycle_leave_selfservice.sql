-- Phases 2, 4 and 6: employee self-service, a real leave engine, and the
-- probation/exit lifecycle. Grouped because they share the same spine — an employee
-- record moving through time — and splitting them would mean three migrations that
-- each half-define the same relationships.

-- ═══ Phase 2: profile change requests ═══════════════════════════════════
-- Keka has 41 of these sitting unactioned, which says employees do want to maintain
-- their own data. The employee edits a copy, not the live row; HR applies it.
CREATE TABLE IF NOT EXISTS public.employee_profile_change_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  requested_by        uuid REFERENCES auth.users(id),
  -- { field: {from, to} } — the diff, so a reviewer sees exactly what changes.
  changes             jsonb NOT NULL,
  note                text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by         uuid REFERENCES auth.users(id),
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_profile_change_requests_pending_idx
  ON public.employee_profile_change_requests (status, created_at DESC)
  WHERE status = 'pending';

-- Fields an employee may request changes to. Deliberately excludes job_title,
-- campus, salary, employment_status and legal entity: those are HR's to set, and an
-- employee proposing their own designation is not a request, it is a promotion.
CREATE OR REPLACE FUNCTION public.employee_self_editable_fields()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'personal_email','mobile_number','work_number','residence_number',
    'current_address','permanent_address','marital_status','blood_group',
    'date_of_birth','gender','nationality','education','experience',
    'emergency_contact_name','emergency_contact_phone'
  ];
$$;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name  text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;

-- Applying a request writes the approved diff onto the live row. SECURITY DEFINER so
-- the field allow-list is enforced server-side: a crafted request cannot smuggle in
-- a salary or a campus change.
CREATE OR REPLACE FUNCTION public.apply_profile_change_request(_request_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        public.employee_profile_change_requests;
  k        text;
  allowed  text[] := public.employee_self_editable_fields();
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:employees_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO r FROM public.employee_profile_change_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is already %', r.status; END IF;

  IF _approve THEN
    FOR k IN SELECT jsonb_object_keys(r.changes) LOOP
      IF NOT (k = ANY(allowed)) THEN
        RAISE EXCEPTION 'Field % cannot be changed by an employee request', k;
      END IF;
      EXECUTE format('UPDATE public.employee_profiles SET %I = $1 WHERE id = $2', k)
        USING (r.changes -> k ->> 'to'), r.employee_profile_id;
    END LOOP;
  END IF;

  UPDATE public.employee_profile_change_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
   WHERE id = _request_id;
END;
$$;

-- ═══ Phase 4: leave engine ══════════════════════════════════════════════
-- NIMT runs five distinct leave policies (teaching vs non-teaching vs Seralis).
-- Flat per-user balances cannot express that, so plans own types and employees are
-- assigned to a plan.
CREATE TABLE IF NOT EXISTS public.leave_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE SET NULL,
  -- Leave years differ from financial years; Keka's plans run Jan-Dec.
  year_start_month smallint NOT NULL DEFAULT 1 CHECK (year_start_month BETWEEN 1 AND 12),
  is_default      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.leave_types (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_plan_id  uuid NOT NULL REFERENCES public.leave_plans(id) ON DELETE CASCADE,
  code           text NOT NULL,
  name           text NOT NULL,
  annual_days    numeric(6,2) NOT NULL DEFAULT 0,
  -- 'annual'  → whole entitlement granted at the start of the leave year
  -- 'monthly' → accrues annual_days/12 each completed month
  accrual        text NOT NULL DEFAULT 'annual' CHECK (accrual IN ('annual', 'monthly')),
  carry_forward_max numeric(6,2) NOT NULL DEFAULT 0,
  is_paid        boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  display_order  integer NOT NULL DEFAULT 0,
  UNIQUE (leave_plan_id, code)
);

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS leave_plan_id uuid REFERENCES public.leave_plans(id);

-- Balances per employee, per type, per leave year. Replaces the flat
-- employee_leave_balances keyed on a free-text leave_type, which could not
-- represent two plans with the same type name and different entitlements.
CREATE TABLE IF NOT EXISTS public.employee_leave_entitlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  leave_type_id       uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  leave_year          integer NOT NULL,
  entitled_days       numeric(6,2) NOT NULL DEFAULT 0,
  carried_forward     numeric(6,2) NOT NULL DEFAULT 0,
  used_days           numeric(6,2) NOT NULL DEFAULT 0,
  -- Generated so "how much is left" can never drift from its inputs.
  available_days      numeric(6,2) GENERATED ALWAYS AS
                        (entitled_days + carried_forward - used_days) STORED,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_profile_id, leave_type_id, leave_year)
);

CREATE INDEX IF NOT EXISTS employee_leave_entitlements_employee_idx
  ON public.employee_leave_entitlements (employee_profile_id, leave_year);

-- Grant a leave year's entitlement to everyone on a plan. Idempotent: re-running
-- tops up entitled_days without touching what has already been used.
CREATE OR REPLACE FUNCTION public.grant_leave_entitlements(_leave_plan_id uuid, _leave_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:leave_approve') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  INSERT INTO public.employee_leave_entitlements
    (employee_profile_id, leave_type_id, leave_year, entitled_days)
  SELECT e.id, t.id, _leave_year, t.annual_days
    FROM public.employee_profiles e
    JOIN public.leave_types t ON t.leave_plan_id = _leave_plan_id
   WHERE e.leave_plan_id = _leave_plan_id
     AND e.verification_status = 'verified'
     AND (e.employment_status IS NULL OR e.employment_status IN ('Working', 'On Notice'))
  ON CONFLICT (employee_profile_id, leave_type_id, leave_year)
  DO UPDATE SET entitled_days = EXCLUDED.entitled_days, updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Keep used_days in step with approved requests. Doing this in the database rather
-- than the UI means a balance cannot drift when a request is approved by a script,
-- an import, or a second tab.
ALTER TABLE public.employee_leave_requests
  ADD COLUMN IF NOT EXISTS leave_type_id uuid REFERENCES public.leave_types(id),
  ADD COLUMN IF NOT EXISTS employee_profile_id uuid REFERENCES public.employee_profiles(id);

CREATE OR REPLACE FUNCTION public.sync_leave_entitlement_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_year integer;
BEGIN
  IF NEW.leave_type_id IS NULL OR NEW.employee_profile_id IS NULL THEN RETURN NULL; END IF;
  v_year := EXTRACT(YEAR FROM NEW.start_date);

  -- Recompute from the approved requests themselves rather than incrementing, so a
  -- retro-edit or a double-fired trigger cannot double-count.
  UPDATE public.employee_leave_entitlements ent
     SET used_days = COALESCE((
           SELECT sum(r.days) FROM public.employee_leave_requests r
            WHERE r.employee_profile_id = NEW.employee_profile_id
              AND r.leave_type_id = NEW.leave_type_id
              AND r.status = 'approved'
              AND EXTRACT(YEAR FROM r.start_date) = v_year
         ), 0),
         updated_at = now()
   WHERE ent.employee_profile_id = NEW.employee_profile_id
     AND ent.leave_type_id = NEW.leave_type_id
     AND ent.leave_year = v_year;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS leave_requests_sync_usage ON public.employee_leave_requests;
CREATE TRIGGER leave_requests_sync_usage
  AFTER INSERT OR UPDATE OF status, days ON public.employee_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_leave_entitlement_usage();

-- ═══ Phase 6: probation and exits ═══════════════════════════════════════
-- 29 probations sat unconfirmed in Keka because nothing surfaced them.
ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS probation_end_date  date,
  ADD COLUMN IF NOT EXISTS probation_status    text
    CHECK (probation_status IN ('on_probation', 'confirmed', 'extended')),
  ADD COLUMN IF NOT EXISTS confirmed_on        date;

CREATE INDEX IF NOT EXISTS employee_profiles_probation_due_idx
  ON public.employee_profiles (probation_end_date)
  WHERE probation_status = 'on_probation';

CREATE TABLE IF NOT EXISTS public.employee_exits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  exit_type           text NOT NULL DEFAULT 'resignation'
                        CHECK (exit_type IN ('resignation', 'termination', 'retirement', 'end_of_contract', 'absconded')),
  resignation_date    date,
  last_working_day    date,
  notice_waived       boolean NOT NULL DEFAULT false,
  reason              text,
  status              text NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'completed', 'reverted')),
  -- Clearance is a checklist, not a single flag; each owner signs off separately.
  clearance           jsonb NOT NULL DEFAULT '{}'::jsonb,
  exit_interview_note text,
  final_settlement_amount numeric(14,2),
  settled_on          date,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_profile_id)
);

-- Completing an exit sets the employee's exit date, which is what payroll's
-- auto-population reads to stop paying them. Keeping the two in step in the database
-- means an exit can never be recorded while payroll keeps issuing salary.
CREATE OR REPLACE FUNCTION public.sync_employee_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.last_working_day IS NOT NULL THEN
    UPDATE public.employee_profiles
       SET date_of_exit = NEW.last_working_day,
           employment_status = CASE
             WHEN NEW.exit_type = 'termination' THEN 'Terminated'
             ELSE 'Resigned' END
     WHERE id = NEW.employee_profile_id;
  ELSIF NEW.status = 'reverted' THEN
    UPDATE public.employee_profiles
       SET date_of_exit = NULL, employment_status = 'Working'
     WHERE id = NEW.employee_profile_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS employee_exits_sync ON public.employee_exits;
CREATE TRIGGER employee_exits_sync
  AFTER INSERT OR UPDATE OF status, last_working_day ON public.employee_exits
  FOR EACH ROW EXECUTE FUNCTION public.sync_employee_exit();

DROP TRIGGER IF EXISTS update_employee_exits_updated_at ON public.employee_exits;
CREATE TRIGGER update_employee_exits_updated_at
  BEFORE UPDATE ON public.employee_exits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══ Seed NIMT's real leave plans ═══════════════════════════════════════
INSERT INTO public.leave_plans (name, is_default, description) VALUES
  ('NIMT Leave Policy',              true,  'Default plan for non-teaching staff'),
  ('Teaching staff Leave plan',      false, 'Teaching staff'),
  ('Teaching Staff Leave Policy 2025', false, 'Teaching staff, 2025 revision'),
  ('Seralis Leave Policy 1',         false, 'Seralis Lab Diagnostics'),
  ('Executive Management Leave Plan', false, 'Executive management')
ON CONFLICT (name) DO NOTHING;

UPDATE public.leave_plans
   SET legal_entity_id = (SELECT id FROM public.legal_entities WHERE name = 'Seralis Lab Diagnostics LLP')
 WHERE name = 'Seralis Leave Policy 1' AND legal_entity_id IS NULL;

-- Conventional Indian entitlements as a starting point for every plan. These are a
-- placeholder until the real policy document is loaded — annual_days is editable.
INSERT INTO public.leave_types (leave_plan_id, code, name, annual_days, accrual, carry_forward_max, is_paid, display_order)
SELECT p.id, t.code, t.name, t.days, t.accrual, t.cf, t.paid, t.ord
  FROM public.leave_plans p
 CROSS JOIN (VALUES
   ('CL', 'Casual Leave',    12, 'annual',  0,  true,  10),
   ('SL', 'Sick Leave',      12, 'annual',  0,  true,  20),
   ('EL', 'Earned Leave',    15, 'monthly', 30, true,  30),
   ('LWP','Leave Without Pay', 0, 'annual', 0,  false, 90)
 ) AS t(code, name, days, accrual, cf, paid, ord)
ON CONFLICT (leave_plan_id, code) DO NOTHING;

-- ═══ RLS ════════════════════════════════════════════════════════════════
ALTER TABLE public.employee_profile_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_plans                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_types                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_leave_entitlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_exits                   ENABLE ROW LEVEL SECURITY;

-- An employee raises and sees their own requests; HR sees and actions all of them.
DROP POLICY IF EXISTS "Employees raise own change requests" ON public.employee_profile_change_requests;
CREATE POLICY "Employees raise own change requests"
  ON public.employee_profile_change_requests FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employee_profiles e
     WHERE e.id = employee_profile_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Employees read own change requests" ON public.employee_profile_change_requests;
CREATE POLICY "Employees read own change requests"
  ON public.employee_profile_change_requests FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employee_profiles e
     WHERE e.id = employee_profile_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "HR manages change requests" ON public.employee_profile_change_requests;
CREATE POLICY "HR manages change requests"
  ON public.employee_profile_change_requests FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

-- Leave plan definitions are reference data any employee may read to understand
-- their own entitlement; only leave approvers may change them.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_plans', 'leave_types'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Authenticated read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "HR manages %1$s" ON public.%1$I', t);
    EXECUTE format($f$
      CREATE POLICY "HR manages %1$s" ON public.%1$I FOR ALL TO authenticated
        USING ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')))
        WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')))
    $f$, t);
  END LOOP;
END $do$;

DROP POLICY IF EXISTS "Employees read own entitlements" ON public.employee_leave_entitlements;
CREATE POLICY "Employees read own entitlements"
  ON public.employee_leave_entitlements FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employee_profiles e
     WHERE e.id = employee_profile_id AND e.user_id = auth.uid()
  ) OR (SELECT public.has_permission(auth.uid(), 'hr:view')));

DROP POLICY IF EXISTS "HR manages entitlements" ON public.employee_leave_entitlements;
CREATE POLICY "HR manages entitlements"
  ON public.employee_leave_entitlements FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:leave_approve')));

DROP POLICY IF EXISTS "HR manages exits" ON public.employee_exits;
CREATE POLICY "HR manages exits"
  ON public.employee_exits FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

DROP POLICY IF EXISTS "Employees read own exit" ON public.employee_exits;
CREATE POLICY "Employees read own exit"
  ON public.employee_exits FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employee_profiles e
     WHERE e.id = employee_profile_id AND e.user_id = auth.uid()
  ));

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_profile_change_requests', 'leave_plans', 'leave_types',
    'employee_leave_entitlements', 'employee_exits'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $do$;

GRANT EXECUTE ON FUNCTION public.apply_profile_change_request(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_leave_entitlements(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_leave_entitlement_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_employee_exit() FROM PUBLIC;
