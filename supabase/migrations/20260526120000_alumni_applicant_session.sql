-- Fix alumni portal submission: applicants with no staff/student/parent profile
-- previously fell through OTP verify with no auth token, so subsequent inserts
-- ran as `anon`. PostgREST wraps .insert().select() as a CTE with SELECT, which
-- requires the returned row to be visible under SELECT RLS — anon has no
-- SELECT policy on alumni_verification_requests, so the insert errored with
-- "new row violates row-level security policy".
--
-- The whatsapp-otp edge function now provisions an "alumni" auth user on the
-- fallback path and returns a session, so subsequent calls run as authenticated.
-- The "Auth can insert" + "Alumni applicants view own by phone" policies then
-- permit the round-trip.
--
-- Phone is stored in raw_user_meta_data->>'phone' (not auth.users.phone, which
-- has a UNIQUE index that would collide with parents+students sharing a phone).
-- Extend current_user_phone() to coalesce both sources.

CREATE OR REPLACE FUNCTION public.current_user_phone()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT COALESCE(
    NULLIF(phone, ''),
    raw_user_meta_data->>'phone'
  )
  FROM auth.users
  WHERE id = auth.uid()
$$;
