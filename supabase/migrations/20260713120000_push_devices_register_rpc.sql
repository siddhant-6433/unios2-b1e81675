-- Fix push_devices client registration:
-- 1) GRANT so authenticated can touch the table (CREATE TABLE alone is not enough
--    when default privileges were tightened).
-- 2) UPDATE policy WITH CHECK so upserts that set user_id/disabled_at succeed.
-- 3) SECURITY DEFINER register_push_device() so a shared device can re-claim a
--    token that still points at a previous user (RLS upsert cannot update that row).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;

DROP POLICY IF EXISTS "push_devices_update_own" ON public.push_devices;
CREATE POLICY "push_devices_update_own"
  ON public.push_devices FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.register_push_device(
  p_token text,
  p_platform text,
  p_app_variant text,
  p_device_name text DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid platform';
  END IF;

  IF p_app_variant NOT IN ('staff', 'family') THEN
    RAISE EXCEPTION 'invalid app_variant';
  END IF;

  INSERT INTO public.push_devices (
    user_id,
    expo_push_token,
    platform,
    app_variant,
    device_name,
    app_version,
    last_seen_at,
    disabled_at
  )
  VALUES (
    auth.uid(),
    p_token,
    p_platform,
    p_app_variant,
    p_device_name,
    p_app_version,
    now(),
    NULL
  )
  ON CONFLICT (expo_push_token) DO UPDATE SET
    user_id = auth.uid(),
    platform = EXCLUDED.platform,
    app_variant = EXCLUDED.app_variant,
    device_name = EXCLUDED.device_name,
    app_version = EXCLUDED.app_version,
    last_seen_at = now(),
    disabled_at = NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text, text) TO service_role;
