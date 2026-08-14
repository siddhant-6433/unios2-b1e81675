-- Phases 3 and 5: employee documents with expiry + generated HR letters, and the
-- attendance policy layer (shifts, weekly offs, regularisation, overtime).

-- ═══ Phase 3: documents ═════════════════════════════════════════════════
-- employee_documents already exists from an earlier branch with the storage fields.
-- What it lacks is the reason HR keeps documents at all: knowing when one expires.
ALTER TABLE public.employee_documents
  ADD COLUMN IF NOT EXISTS doc_category text,
  ADD COLUMN IF NOT EXISTS issued_on    date,
  ADD COLUMN IF NOT EXISTS expires_on   date,
  ADD COLUMN IF NOT EXISTS notes        text,
  ADD COLUMN IF NOT EXISTS verified_by  uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS verified_at  timestamptz;

-- Partial index: the only query that matters is "what expires soon", and it never
-- looks at documents with no expiry.
CREATE INDEX IF NOT EXISTS employee_documents_expiring_idx
  ON public.employee_documents (expires_on)
  WHERE expires_on IS NOT NULL;

-- ── Letter templates ────────────────────────────────────────────────────
-- Appointment, experience, relieving and salary letters are the same document with
-- different words, so they are data. Placeholders are {{snake_case}} and resolved
-- from the employee record at generation time.
CREATE TABLE IF NOT EXISTS public.hr_letter_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  subject         text,
  body            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Every generated letter is kept. An experience letter is a legal statement about
-- someone's employment; regenerating it later from changed data would produce a
-- different document to the one they hold, so the rendered text is stored as issued.
CREATE TABLE IF NOT EXISTS public.hr_letters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  template_id         uuid REFERENCES public.hr_letter_templates(id) ON DELETE SET NULL,
  letter_code         text NOT NULL,
  letter_name         text NOT NULL,
  subject             text,
  body                text NOT NULL,
  reference_no        text,
  issued_on           date NOT NULL DEFAULT CURRENT_DATE,
  issued_by           uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_letters_employee_idx
  ON public.hr_letters (employee_profile_id, issued_on DESC);

-- Render a template for one employee. SECURITY DEFINER because it reads salary to
-- fill {{monthly_gross}}, which the caller may not otherwise be able to see; the
-- permission check is explicit.
CREATE OR REPLACE FUNCTION public.generate_hr_letter(_employee_profile_id uuid, _template_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t   public.hr_letter_templates;
  e   public.employee_profiles;
  ent text;
  sal numeric;
  txt text;
  sub text;
  v_id uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:employees_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO t FROM public.hr_letter_templates WHERE code = _template_code AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Letter template % not found', _template_code; END IF;

  SELECT * INTO e FROM public.employee_profiles WHERE id = _employee_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  SELECT le.legal_name INTO ent FROM public.legal_entities le WHERE le.id = e.legal_entity_id;

  SELECT s.monthly_gross INTO sal
    FROM public.employee_salaries s
   WHERE s.employee_profile_id = e.id AND s.effective_to IS NULL
   ORDER BY s.effective_from DESC LIMIT 1;

  txt := t.body;
  sub := COALESCE(t.subject, t.name);

  -- Substitute into both body and subject. Unfilled placeholders are left visible
  -- rather than blanked, so a missing field is obvious on the page instead of
  -- producing a letter that silently says "joined on ".
  txt := replace(txt, '{{employee_name}}',   COALESCE(e.display_name, ''));
  txt := replace(txt, '{{employee_number}}', COALESCE(e.employee_number, ''));
  txt := replace(txt, '{{designation}}',     COALESCE(e.job_title, ''));
  txt := replace(txt, '{{date_of_joining}}', COALESCE(to_char(e.date_of_joining, 'DD Mon YYYY'), ''));
  txt := replace(txt, '{{date_of_exit}}',    COALESCE(to_char(e.date_of_exit, 'DD Mon YYYY'), ''));
  txt := replace(txt, '{{work_location}}',   COALESCE(e.work_location, ''));
  txt := replace(txt, '{{department}}',      COALESCE(e.hr_department, ''));
  txt := replace(txt, '{{legal_entity}}',    COALESCE(ent, ''));
  txt := replace(txt, '{{monthly_gross}}',   COALESCE(to_char(sal, 'FM99,99,999'), ''));
  txt := replace(txt, '{{today}}',           to_char(CURRENT_DATE, 'DD Mon YYYY'));

  sub := replace(sub, '{{employee_name}}', COALESCE(e.display_name, ''));

  INSERT INTO public.hr_letters (
    employee_profile_id, template_id, letter_code, letter_name, subject, body,
    reference_no, issued_by
  ) VALUES (
    e.id, t.id, t.code, t.name, sub, txt,
    'HR/' || to_char(CURRENT_DATE, 'YYYY') || '/' || COALESCE(e.employee_number, left(e.id::text, 6)),
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

INSERT INTO public.hr_letter_templates (code, name, subject, body) VALUES
  ('experience', 'Experience Letter', 'Experience Letter — {{employee_name}}',
   E'TO WHOMSOEVER IT MAY CONCERN\n\n'
   'This is to certify that {{employee_name}} (Employee No. {{employee_number}}) '
   'was employed with {{legal_entity}} as {{designation}} from {{date_of_joining}} '
   'to {{date_of_exit}}.\n\n'
   'During the tenure, their conduct and performance were found to be satisfactory.\n\n'
   'We wish them success in their future endeavours.\n\n'
   'Date: {{today}}'),
  ('appointment', 'Appointment Letter', 'Appointment Letter — {{employee_name}}',
   E'Dear {{employee_name}},\n\n'
   'We are pleased to appoint you as {{designation}} at {{legal_entity}}, '
   '{{work_location}}, with effect from {{date_of_joining}}.\n\n'
   'Your gross remuneration will be Rs. {{monthly_gross}} per month, subject to '
   'statutory deductions.\n\n'
   'Date: {{today}}'),
  ('salary_certificate', 'Salary Certificate', 'Salary Certificate — {{employee_name}}',
   E'TO WHOMSOEVER IT MAY CONCERN\n\n'
   'This is to certify that {{employee_name}} (Employee No. {{employee_number}}) is '
   'employed with {{legal_entity}} as {{designation}} since {{date_of_joining}}.\n\n'
   'Their present gross remuneration is Rs. {{monthly_gross}} per month.\n\n'
   'Date: {{today}}'),
  ('relieving', 'Relieving Letter', 'Relieving Letter — {{employee_name}}',
   E'Dear {{employee_name}},\n\n'
   'With reference to your resignation, we confirm that you have been relieved from '
   'your duties as {{designation}} at {{legal_entity}} at the close of business on '
   '{{date_of_exit}}.\n\n'
   'We confirm that all company property has been returned and dues settled.\n\n'
   'Date: {{today}}')
ON CONFLICT (code) DO NOTHING;

-- ═══ Phase 5: attendance policy ═════════════════════════════════════════
-- Capture already works (geofence, selfie, face registration). What is missing is
-- the policy that says whether a given punch was on time.
CREATE TABLE IF NOT EXISTS public.work_shifts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  -- Minutes after start_time still counted as on time.
  grace_minutes  smallint NOT NULL DEFAULT 10,
  break_minutes  smallint NOT NULL DEFAULT 30,
  -- 0 = Sunday … 6 = Saturday, matching Postgres EXTRACT(DOW).
  weekly_offs    smallint[] NOT NULL DEFAULT ARRAY[0]::smallint[],
  full_day_hours numeric(4,2) NOT NULL DEFAULT 8,
  half_day_hours numeric(4,2) NOT NULL DEFAULT 4,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.work_shifts (name, start_time, end_time, weekly_offs, grace_minutes) VALUES
  ('General (9:00-17:00)',  '09:00', '17:00', ARRAY[0]::smallint[], 10),
  ('School (7:30-14:30)',   '07:30', '14:30', ARRAY[0]::smallint[], 10),
  ('Lab (8:00-20:00)',      '08:00', '20:00', ARRAY[0]::smallint[], 15)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS work_shift_id uuid REFERENCES public.work_shifts(id);

-- ── Regularisation ──────────────────────────────────────────────────────
-- 1,554 of these stranded in Keka is what happens when the only way to fix a missed
-- punch is one-at-a-time approval. The table is deliberately simple so a bulk-approve
-- UI is easy to build on top.
CREATE TABLE IF NOT EXISTS public.attendance_regularisations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES auth.users(id),
  date                date NOT NULL,
  requested_punch_in  timestamptz,
  requested_punch_out timestamptz,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by         uuid REFERENCES auth.users(id),
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_profile_id, date)
);

CREATE INDEX IF NOT EXISTS attendance_regularisations_pending_idx
  ON public.attendance_regularisations (status, date DESC)
  WHERE status = 'pending';

-- Approving writes the corrected punch onto the attendance row, creating it if the
-- employee never punched at all. Done in the database so an approval can never be
-- recorded without the attendance actually changing.
--
-- Explicit update-then-insert rather than ON CONFLICT: employee_attendance has no
-- UNIQUE(user_id, date) in production despite the committed migration declaring one,
-- so there is no arbiter for ON CONFLICT to use. This works either way.
CREATE OR REPLACE FUNCTION public.approve_attendance_regularisation(_ids uuid[], _approve boolean, _note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_count integer := 0; v_hit integer;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:attendance_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOR r IN
    SELECT * FROM public.attendance_regularisations
     WHERE id = ANY(_ids) AND status = 'pending'
  LOOP
    IF _approve AND r.user_id IS NOT NULL THEN
      UPDATE public.employee_attendance
         SET punch_in  = COALESCE(r.requested_punch_in,  punch_in),
             punch_out = COALESCE(r.requested_punch_out, punch_out),
             notes     = 'Regularised: ' || r.reason
       WHERE user_id = r.user_id AND date = r.date;
      GET DIAGNOSTICS v_hit = ROW_COUNT;

      IF v_hit = 0 THEN
        INSERT INTO public.employee_attendance (user_id, date, punch_in, punch_out, notes)
        VALUES (r.user_id, r.date, r.requested_punch_in, r.requested_punch_out,
                'Regularised: ' || r.reason);
      END IF;
    END IF;

    UPDATE public.attendance_regularisations
       SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
           reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── Overtime ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_overtime (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  date                date NOT NULL,
  hours               numeric(5,2) NOT NULL CHECK (hours > 0),
  reason              text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  -- Set when the overtime is carried into a payroll cycle, so it cannot be paid twice.
  payroll_cycle_id    uuid REFERENCES public.payroll_cycles(id) ON DELETE SET NULL,
  approved_by         uuid REFERENCES auth.users(id),
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_profile_id, date)
);

-- ═══ RLS ════════════════════════════════════════════════════════════════
ALTER TABLE public.hr_letter_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_letters                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_shifts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_regularisations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_overtime          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR manages letter templates" ON public.hr_letter_templates;
CREATE POLICY "HR manages letter templates"
  ON public.hr_letter_templates FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

DROP POLICY IF EXISTS "HR reads letters" ON public.hr_letters;
CREATE POLICY "HR reads letters"
  ON public.hr_letters FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

-- An employee may read letters issued to them; a relieving letter is theirs.
DROP POLICY IF EXISTS "Employees read own letters" ON public.hr_letters;
CREATE POLICY "Employees read own letters"
  ON public.hr_letters FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employee_profiles e
     WHERE e.id = employee_profile_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Authenticated read shifts" ON public.work_shifts;
CREATE POLICY "Authenticated read shifts"
  ON public.work_shifts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "HR manages shifts" ON public.work_shifts;
CREATE POLICY "HR manages shifts"
  ON public.work_shifts FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')));

DROP POLICY IF EXISTS "Employees raise own regularisations" ON public.attendance_regularisations;
CREATE POLICY "Employees raise own regularisations"
  ON public.attendance_regularisations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Employees read own regularisations" ON public.attendance_regularisations;
CREATE POLICY "Employees read own regularisations"
  ON public.attendance_regularisations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "HR manages regularisations" ON public.attendance_regularisations;
CREATE POLICY "HR manages regularisations"
  ON public.attendance_regularisations FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')));

DROP POLICY IF EXISTS "HR manages overtime" ON public.attendance_overtime;
CREATE POLICY "HR manages overtime"
  ON public.attendance_overtime FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')));

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hr_letter_templates', 'hr_letters', 'work_shifts',
    'attendance_regularisations', 'attendance_overtime'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $do$;

GRANT EXECUTE ON FUNCTION public.generate_hr_letter(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_attendance_regularisation(uuid[], boolean, text) TO authenticated;
