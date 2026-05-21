-- profiles.official_phone: counsellor's customer-facing phone number that
-- goes into WhatsApp follow-up signatures.
--
-- profiles.phone already exists but it's the counsellor's personal mobile
-- (used by the Plivo bridge to ring the counsellor on a manual call). We do
-- not want that surfaced to leads. official_phone is a separate, opt-in
-- field the admin can populate per counsellor with e.g. a Plivo DID, a
-- desk extension, or a public-facing number.
--
-- Resolver fallback order in fn_signature_for_counsellor:
--   1. profiles.official_phone (if set)
--   2. PLIVO_DIALER_PHONE_NUMBER (the cloud-dialer outbound number — set
--      via the `app.settings.plivo_dialer_phone` postgres setting)
--   3. +91 9555 192 192 (NIMT admissions hardcoded fallback)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS official_phone text;

COMMENT ON COLUMN public.profiles.official_phone IS
  'Customer-facing phone number used in WhatsApp follow-up signatures. Distinct from profiles.phone (personal mobile used by Plivo bridge). When NULL, the resolver falls back to the cloud-dialer Plivo DID and finally the NIMT admissions number.';

-- ── Signature resolver ─────────────────────────────────────────────────────
-- Returns the (counsellor_name, counsellor_phone) tuple for a given lead so
-- whatsapp-send can fill the nimt_followup_v1 signature without baking the
-- fallback chain into the edge-function client.
CREATE OR REPLACE FUNCTION public.fn_resolve_counsellor_signature(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text;
  v_phone text;
  v_plivo text;
BEGIN
  SELECT p.display_name,
         NULLIF(trim(p.official_phone), '')
    INTO v_name, v_phone
    FROM public.leads l
    JOIN public.profiles p ON p.id = l.counsellor_id
   WHERE l.id = p_lead_id;

  -- 2nd preference: cloud-dialer Plivo DID. We read this from a postgres
  -- setting so the deployer can set it without code changes. Setting key
  -- mirrors the existing app.settings.* convention used elsewhere.
  IF v_phone IS NULL THEN
    BEGIN
      v_plivo := current_setting('app.settings.plivo_dialer_phone', true);
      IF v_plivo IS NOT NULL AND length(trim(v_plivo)) > 0 THEN
        v_phone := trim(v_plivo);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_phone := NULL;
    END;
  END IF;

  -- 3rd preference: NIMT admissions hardcoded fallback.
  IF v_phone IS NULL THEN
    v_phone := '+91 9555 192 192';
  END IF;

  RETURN jsonb_build_object(
    'counsellor_name',  COALESCE(NULLIF(trim(v_name), ''), 'the admissions team'),
    'counsellor_phone', v_phone
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_counsellor_signature(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_resolve_counsellor_signature(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_resolve_counsellor_signature(uuid) IS
  'Returns {counsellor_name, counsellor_phone} for a lead. Phone fallback: profiles.official_phone → app.settings.plivo_dialer_phone → +91 9555 192 192.';
