-- Tighten alumni_verification_requests RLS.
--
-- Prior state:
--   "Anon can insert"        INSERT  {anon} with_check=true
--   "Anon can read by phone" SELECT  {anon} qual=true       — leak: anon can dump every row
--   "Anon can update own"    UPDATE  {anon} qual=true       — leak: anon can mutate any row
--   "Auth can delete"        DELETE  {auth} scoped to super_admin/campus_admin/office_admin
--   "Auth can insert"        INSERT  {auth} with_check=true
--   "Auth can read all"      SELECT  {auth} qual=true       — too broad (any auth user)
--   "Auth can update"        UPDATE  {auth} qual=EXISTS(user_roles WHERE user_id=auth.uid())
--                                                            — too broad: any auth user with any
--                                                              role record can update any row.
--
-- src/pages/AlumniVerification.tsx is the public-facing portal. It uses the
-- whatsapp-otp edge function for verification, which already returns an
-- access_token. AlumniVerification.OtpLogin updated in the same change to
-- call supabase.auth.setSession() with that token — subsequent DB calls are
-- now authenticated as the verified phone's user. RLS can therefore drop the
-- anon SELECT/UPDATE policies and scope authenticated access by phone match.
--
-- AlumniVerifications.tsx is the staff-side review page; covered by the new
-- "Staff" policies.

DROP POLICY IF EXISTS "Anon can read by phone" ON public.alumni_verification_requests;
DROP POLICY IF EXISTS "Anon can update own"    ON public.alumni_verification_requests;
DROP POLICY IF EXISTS "Auth can read all"      ON public.alumni_verification_requests;
DROP POLICY IF EXISTS "Auth can update"        ON public.alumni_verification_requests;

-- Anon INSERT stays (public submit form before auth), but is now strictly
-- INSERT-only. Anon cannot SELECT or UPDATE — page must authenticate first.

-- Authenticated SELECT — applicants see only their own (phone match) rows,
-- staff see everything.
CREATE POLICY "Alumni applicants view own by phone"
  ON public.alumni_verification_requests FOR SELECT TO authenticated
  USING (
    requestor_phone IS NOT NULL AND requestor_phone <> ''
    AND regexp_replace(requestor_phone, '\D', '', 'g') = regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g')
    AND coalesce(public.current_user_phone(), '') <> ''
  );

CREATE POLICY "Staff view all alumni verifications"
  ON public.alumni_verification_requests FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
  );

-- Authenticated UPDATE — same scoping.
CREATE POLICY "Alumni applicants update own by phone"
  ON public.alumni_verification_requests FOR UPDATE TO authenticated
  USING (
    requestor_phone IS NOT NULL AND requestor_phone <> ''
    AND regexp_replace(requestor_phone, '\D', '', 'g') = regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g')
    AND coalesce(public.current_user_phone(), '') <> ''
  )
  WITH CHECK (
    requestor_phone IS NOT NULL AND requestor_phone <> ''
    AND regexp_replace(requestor_phone, '\D', '', 'g') = regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g')
    AND coalesce(public.current_user_phone(), '') <> ''
  );

CREATE POLICY "Staff update alumni verifications"
  ON public.alumni_verification_requests FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
  );
