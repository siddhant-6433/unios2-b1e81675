-- Fix the applications RLS policies from 20260610040000.
--
-- The original policies referenced auth.users directly (`SELECT phone FROM
-- auth.users WHERE id = auth.uid()`), but the `authenticated` role doesn't
-- have SELECT on auth.users, so every authenticated query failed with
-- 'permission denied for table users'.
--
-- Add SECURITY DEFINER helper functions that the policies can call, and
-- recreate the four "Applicants ... own ... by phone/email" policies on top
-- of those helpers. The 'Staff view/update' policies don't reference auth.users
-- so they remain unchanged.

CREATE OR REPLACE FUNCTION public.current_user_phone()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, auth
AS $$ SELECT phone FROM auth.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, auth
AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;

GRANT EXECUTE ON FUNCTION public.current_user_phone() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated, anon;

DROP POLICY IF EXISTS "Applicants view own application by phone" ON public.applications;
DROP POLICY IF EXISTS "Applicants view own application by email" ON public.applications;
DROP POLICY IF EXISTS "Applicants update own application by phone" ON public.applications;
DROP POLICY IF EXISTS "Applicants update own application by email" ON public.applications;

CREATE POLICY "Applicants view own application by phone"
  ON public.applications FOR SELECT TO authenticated
  USING (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g')
    AND coalesce(public.current_user_phone(), '') <> ''
  );

CREATE POLICY "Applicants view own application by email"
  ON public.applications FOR SELECT TO authenticated
  USING (
    email IS NOT NULL AND email <> ''
    AND lower(email) = lower(coalesce(public.current_user_email(), ''))
    AND coalesce(public.current_user_email(), '') <> ''
  );

CREATE POLICY "Applicants update own application by phone"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g')
    AND coalesce(public.current_user_phone(), '') <> ''
  )
  WITH CHECK (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g')
    AND coalesce(public.current_user_phone(), '') <> ''
  );

CREATE POLICY "Applicants update own application by email"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    email IS NOT NULL AND email <> ''
    AND lower(email) = lower(coalesce(public.current_user_email(), ''))
    AND coalesce(public.current_user_email(), '') <> ''
  )
  WITH CHECK (
    email IS NOT NULL AND email <> ''
    AND lower(email) = lower(coalesce(public.current_user_email(), ''))
    AND coalesce(public.current_user_email(), '') <> ''
  );
