-- Tighten applications RLS.
--
-- Prior state:
--   "Anyone can view applications"           SELECT  {anon,authenticated}  qual=true
--   "Applicants can update own applications" UPDATE  {anon,authenticated}  qual=true with_check=true
--   "Anyone can insert applications"         INSERT  {anon,authenticated}  with_check=true
--   "Only super_admin can delete applications" DELETE                       scoped
--
-- The SELECT-all policy let any anon dump the entire applications table
-- (names, phones, emails, course preferences, payment status). The UPDATE
-- policy let any caller mutate any row despite being named "own".
--
-- Frontend consumers reviewed:
--   - ApplyPortal handleAppIdLookup: previously direct anon SELECT — replaced
--     with public.lookup_application_for_otp() SECURITY DEFINER RPC in
--     20260610030000_lookup_application_for_otp.sql.
--   - ApplyPortal session/insert/update paths: all post-auth; phone/email
--     match the authenticated user's auth.users.phone/email.
--   - ApplicantPortal: filters by phone/email of the authenticated user.
--   - HeaderSearch / AdminApplicationView / TransactionHistoryPanel /
--     Admissions / ApplicationProgress / StudentProfile / Inbox: staff
--     contexts — caught by staff policy.
--
-- Phone format: applications.phone stores '+91XXXXXXXXXX' but auth.users.phone
-- stores '91XXXXXXXXXX' (no plus). Compare digit-only normalized strings.

-- Replace SELECT policy
DROP POLICY IF EXISTS "Anyone can view applications" ON public.applications;

CREATE POLICY "Applicants view own application by phone"
  ON public.applications FOR SELECT TO authenticated
  USING (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') =
        (SELECT regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
         FROM auth.users u WHERE u.id = auth.uid())
    AND (SELECT coalesce(u.phone, '') FROM auth.users u WHERE u.id = auth.uid()) <> ''
  );

CREATE POLICY "Applicants view own application by email"
  ON public.applications FOR SELECT TO authenticated
  USING (
    email IS NOT NULL AND email <> ''
    AND lower(email) =
        (SELECT lower(coalesce(u.email, '')) FROM auth.users u WHERE u.id = auth.uid())
    AND (SELECT coalesce(u.email, '') FROM auth.users u WHERE u.id = auth.uid()) <> ''
  );

CREATE POLICY "Staff view all applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'data_entry'::app_role)
  );

-- Replace UPDATE policy
DROP POLICY IF EXISTS "Applicants can update own applications" ON public.applications;

CREATE POLICY "Applicants update own application by phone"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') =
        (SELECT regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
         FROM auth.users u WHERE u.id = auth.uid())
    AND (SELECT coalesce(u.phone, '') FROM auth.users u WHERE u.id = auth.uid()) <> ''
  )
  WITH CHECK (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') =
        (SELECT regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
         FROM auth.users u WHERE u.id = auth.uid())
    AND (SELECT coalesce(u.phone, '') FROM auth.users u WHERE u.id = auth.uid()) <> ''
  );

CREATE POLICY "Applicants update own application by email"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    email IS NOT NULL AND email <> ''
    AND lower(email) =
        (SELECT lower(coalesce(u.email, '')) FROM auth.users u WHERE u.id = auth.uid())
    AND (SELECT coalesce(u.email, '') FROM auth.users u WHERE u.id = auth.uid()) <> ''
  )
  WITH CHECK (
    email IS NOT NULL AND email <> ''
    AND lower(email) =
        (SELECT lower(coalesce(u.email, '')) FROM auth.users u WHERE u.id = auth.uid())
    AND (SELECT coalesce(u.email, '') FROM auth.users u WHERE u.id = auth.uid()) <> ''
  );

CREATE POLICY "Staff update applications"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'office_assistant'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
  );

-- INSERT and DELETE policies are left as-is.
-- "Anyone can insert applications" remains for the public apply form.
-- "Only super_admin can delete applications" already scoped correctly.
