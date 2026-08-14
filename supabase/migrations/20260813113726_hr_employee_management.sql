-- HR employee management: permission-based RLS, importable (login-less) employees,
-- bank details with audit, and a photo bucket.
--
-- Context: `principal` holds every hr:* permission and passes the /hr route gate,
-- but RLS on employee_profiles only ever allowed super_admin / campus_admin to
-- write. RLS in this DB has used has_role() exclusively; this is the first
-- permission-aware helper, so HR access can be granted by permission row rather
-- than by widening the app_role enum.

-- ── has_permission(): permission checks usable from RLS ─────────────────
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'super_admin'::app_role)
      OR _perm = ANY(public.get_user_permissions(_user_id));
$$;

-- Functions get EXECUTE for PUBLIC by default, which would let an anonymous
-- caller probe any user's permissions over /rest/v1/rpc.
REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;

-- ── employee_profiles: importable rows + verification queue ─────────────
-- user_id nullable so support staff without a login can be imported.
-- The existing UNIQUE(user_id) still holds: Postgres allows many NULLs.
ALTER TABLE public.employee_profiles ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.employee_profiles
    ADD CONSTRAINT employee_profiles_verification_status_check
    CHECK (verification_status IN ('pending', 'verified'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Natural dedup key for imports.
CREATE UNIQUE INDEX IF NOT EXISTS employee_profiles_employee_number_key
  ON public.employee_profiles (employee_number)
  WHERE employee_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS employee_profiles_verification_status_idx
  ON public.employee_profiles (verification_status)
  WHERE verification_status = 'pending';

CREATE INDEX IF NOT EXISTS employee_profiles_import_batch_idx
  ON public.employee_profiles (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- Permission-based access, additive to the existing role-based policies.
-- has_permission() is wrapped in a scalar subquery so Postgres evaluates it
-- once per statement instead of once per row (per-row RLS function calls are
-- a known hot spot in this database).
DROP POLICY IF EXISTS "HR can view all employee profiles" ON public.employee_profiles;
CREATE POLICY "HR can view all employee profiles"
  ON public.employee_profiles FOR SELECT
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:view')));

DROP POLICY IF EXISTS "HR can manage employee profiles" ON public.employee_profiles;
CREATE POLICY "HR can manage employee profiles"
  ON public.employee_profiles FOR ALL
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

-- The self-update policy had no WITH CHECK, so a user could reassign their own
-- user_id and hijack another employee's row.
DROP POLICY IF EXISTS "Users can update own employee profile" ON public.employee_profiles;
CREATE POLICY "Users can update own employee profile"
  ON public.employee_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── hr:bank_edit permission ────────────────────────────────────────────
-- Deliberately NOT granted to principal: bank details are narrower than the
-- rest of the HR module.
INSERT INTO public.permissions (module, action, description)
VALUES ('hr', 'bank_edit', 'View and edit employee bank details')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE v_perm_id uuid;
BEGIN
  SELECT id INTO v_perm_id FROM public.permissions WHERE module = 'hr' AND action = 'bank_edit';
  INSERT INTO public.role_permissions (role, permission_id)
  VALUES ('campus_admin'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
END $$;

-- ── employee_bank_details ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_bank_details (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL UNIQUE
                        REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  account_holder_name text,
  account_number      text,
  ifsc                text,
  bank_name           text,
  branch              text,
  account_type        text,
  updated_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_bank_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR manages employee bank details" ON public.employee_bank_details;
CREATE POLICY "HR manages employee bank details"
  ON public.employee_bank_details FOR ALL
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:bank_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:bank_edit')));

DROP POLICY IF EXISTS "Users can view own bank details" ON public.employee_bank_details;
CREATE POLICY "Users can view own bank details"
  ON public.employee_bank_details FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employee_profiles p
    WHERE p.id = employee_profile_id AND p.user_id = auth.uid()
  ));

-- Table-level grants: RLS never fires without them (a missing GRANT has
-- silently broken tables in this project before).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_bank_details TO authenticated;
GRANT ALL ON public.employee_bank_details TO service_role;

DROP TRIGGER IF EXISTS update_employee_bank_details_updated_at ON public.employee_bank_details;
CREATE TRIGGER update_employee_bank_details_updated_at
  BEFORE UPDATE ON public.employee_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Append-only audit of bank detail changes ───────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_bank_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL,
  action              text NOT NULL,
  changed_by          uuid,
  changed_at          timestamptz NOT NULL DEFAULT now(),
  old_values          jsonb,
  new_values          jsonb
);

CREATE INDEX IF NOT EXISTS employee_bank_audit_profile_idx
  ON public.employee_bank_audit (employee_profile_id, changed_at DESC);

ALTER TABLE public.employee_bank_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR reads employee bank audit" ON public.employee_bank_audit;
CREATE POLICY "HR reads employee bank audit"
  ON public.employee_bank_audit FOR SELECT
  TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:bank_edit')));

-- No INSERT/UPDATE/DELETE policy: rows are written only by the SECURITY
-- DEFINER trigger below, which makes the log append-only from the client.
GRANT SELECT ON public.employee_bank_audit TO authenticated;
GRANT ALL ON public.employee_bank_audit TO service_role;

CREATE OR REPLACE FUNCTION public.log_employee_bank_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.employee_bank_audit (
    employee_profile_id, action, changed_by, old_values, new_values
  ) VALUES (
    COALESCE(NEW.employee_profile_id, OLD.employee_profile_id),
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN NULL;
END;
$$;

-- Trigger-only: nothing should be able to reach this over the REST RPC surface.
REVOKE ALL ON FUNCTION public.log_employee_bank_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS employee_bank_details_audit ON public.employee_bank_details;
CREATE TRIGGER employee_bank_details_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.log_employee_bank_change();

-- ── admin_update_profile: allow HR, not just super_admin ───────────────
-- EmployeeProfileDialog calls this to sync display_name/email/phone back to
-- profiles. It raised 'Forbidden' for everyone but super_admin, and the caller
-- discarded the error, so HR saves half-succeeded silently.
CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_user_id      uuid,
  p_display_name text DEFAULT NULL,
  p_email        text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_salutation   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (has_role(auth.uid(), 'super_admin')
          OR public.has_permission(auth.uid(), 'hr:employees_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    email        = COALESCE(p_email,        email),
    phone        = COALESCE(p_phone,        phone),
    salutation   = COALESCE(p_salutation,   salutation),
    updated_at   = now()
  WHERE user_id = p_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_update_profile(uuid, text, text, text, text) TO authenticated;

-- ── employee-photos storage bucket ─────────────────────────────────────
-- Photos are downscaled client-side before upload; do NOT serve these through
-- Supabase image transformations (the transform quota is metered and blowing
-- it restricted the whole project once).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-photos',
  'employee-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Anyone can view employee photos" ON storage.objects;
CREATE POLICY "Anyone can view employee photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'employee-photos');

DROP POLICY IF EXISTS "HR can upload employee photos" ON storage.objects;
CREATE POLICY "HR can upload employee photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
  );

DROP POLICY IF EXISTS "HR can update employee photos" ON storage.objects;
CREATE POLICY "HR can update employee photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
  );

DROP POLICY IF EXISTS "HR can delete employee photos" ON storage.objects;
CREATE POLICY "HR can delete employee photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
  );
