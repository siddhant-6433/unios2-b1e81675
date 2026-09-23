-- Custom employee fields.
--
-- Institutions differ in what they track (UAN, ESIC number, workstation,
-- uniform size, licence…). Rather than adding a column per request, HR defines
-- fields and records values against them. Definitions are global; values are
-- per employee.

CREATE TABLE IF NOT EXISTS public.employee_field_defs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,
  label         text NOT NULL,
  field_type    text NOT NULL DEFAULT 'text'
                  CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_required   boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 100,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_field_values (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  field_id            uuid NOT NULL REFERENCES public.employee_field_defs(id) ON DELETE CASCADE,
  value               text,
  updated_by          uuid REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_profile_id, field_id)
);
CREATE INDEX IF NOT EXISTS employee_field_values_employee_idx
  ON public.employee_field_values (employee_profile_id);

ALTER TABLE public.employee_field_defs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_field_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read field defs" ON public.employee_field_defs;
CREATE POLICY "Staff read field defs"
  ON public.employee_field_defs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "HR manages field defs" ON public.employee_field_defs;
CREATE POLICY "HR manages field defs"
  ON public.employee_field_defs FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

DROP POLICY IF EXISTS "People read own field values" ON public.employee_field_values;
CREATE POLICY "People read own field values"
  ON public.employee_field_values FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:view'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = employee_field_values.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR manages field values" ON public.employee_field_values;
CREATE POLICY "HR manages field values"
  ON public.employee_field_values FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_field_defs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_field_values TO authenticated;
GRANT ALL ON public.employee_field_defs, public.employee_field_values TO service_role;

CREATE OR REPLACE FUNCTION public.tg_employee_field_defs_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_employee_field_defs_touch ON public.employee_field_defs;
CREATE TRIGGER trg_employee_field_defs_touch
  BEFORE UPDATE ON public.employee_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.tg_employee_field_defs_touch();

-- ── RPCs ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_employee_field_value(
  _employee_profile_id uuid, _field_id uuid, _value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:employees_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _value IS NULL OR btrim(_value) = '' THEN
    DELETE FROM public.employee_field_values
     WHERE employee_profile_id = _employee_profile_id AND field_id = _field_id;
    RETURN;
  END IF;

  INSERT INTO public.employee_field_values (employee_profile_id, field_id, value, updated_by, updated_at)
  VALUES (_employee_profile_id, _field_id, btrim(_value), auth.uid(), now())
  ON CONFLICT (employee_profile_id, field_id)
  DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_employee_field_value(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_field_value(uuid, uuid, text) TO authenticated, service_role;

-- Self read: this employee's active fields with whatever values are recorded.
CREATE OR REPLACE FUNCTION public.my_employee_fields()
RETURNS TABLE (field_id uuid, key text, label text, field_type text, value text, display_order integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = auth.uid();
  IF v_profile IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id, d.key, d.label, d.field_type, v.value, d.display_order
    FROM public.employee_field_defs d
    LEFT JOIN public.employee_field_values v
      ON v.field_id = d.id AND v.employee_profile_id = v_profile
   WHERE d.is_active
   ORDER BY d.display_order, d.label;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_employee_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_employee_fields() TO authenticated, service_role;

-- ── View for HR lists ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.employee_field_values_inbox AS
SELECT
  v.id, v.employee_profile_id, v.field_id, v.value, v.updated_at,
  d.key, d.label, d.field_type, d.display_order,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  e.employee_number
FROM public.employee_field_values v
JOIN public.employee_field_defs d ON d.id = v.field_id
JOIN public.employee_profiles e ON e.id = v.employee_profile_id;

ALTER VIEW public.employee_field_values_inbox SET (security_invoker = true);
GRANT SELECT ON public.employee_field_values_inbox TO authenticated, service_role;
