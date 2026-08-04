-- Deterministic auth-user lookup for student-portal-claim.
--
-- student-portal-claim resolved an existing account with
--   auth.admin.listUsers({ page: 1, perPage: 1000 })
-- and scanned that page in JS. Production has 2,836 auth users, so ~65% of
-- them were invisible to the scan. The consequence was silent and total: for a
-- student whose account sat past row 1000 the function decided "no user
-- exists", called createUser with their real email, got back
-- "email already registered", ran the same capped scan again as a fallback,
-- and returned 500 "Could not create student account".
--
-- Measured before this fix: 31 magic tokens issued, 24 in the preceding 30
-- days, and claimed_at non-null on ZERO of them. 27 of the 31 belonged to
-- students with user_id IS NULL — precisely the branch that could not succeed.
--
-- An indexed lookup is O(1) and cannot silently truncate.

CREATE OR REPLACE FUNCTION public.find_auth_user_by_email_or_phone(
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT u.id
    FROM auth.users u
   WHERE (_email IS NOT NULL AND _email <> '' AND lower(u.email) = lower(_email))
      OR (_phone IS NOT NULL AND _phone <> ''
          AND regexp_replace(COALESCE(u.phone,''), '\D', '', 'g') = regexp_replace(_phone, '\D', '', 'g'))
   -- Prefer the email match: it is the identity student-portal-claim would
   -- otherwise create, and a shared family phone can front several accounts.
   ORDER BY (lower(u.email) = lower(COALESCE(_email,''))) DESC, u.created_at
   LIMIT 1;
$$;

-- service_role ONLY. This maps an email or phone number to an account id, so
-- it must never be reachable from a browser session.
REVOKE ALL ON FUNCTION public.find_auth_user_by_email_or_phone(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_auth_user_by_email_or_phone(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.find_auth_user_by_email_or_phone(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_email_or_phone(text, text) TO service_role;
