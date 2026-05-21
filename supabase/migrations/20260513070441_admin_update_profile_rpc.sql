-- SECURITY DEFINER RPC so super_admin can update any user's profile
-- from the frontend without hitting RLS on the profiles table.
-- The INSERT RLS policy (auth.uid() = user_id) blocks upsert for other users
-- even as super_admin, so we use a dedicated function instead.

CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_user_id    uuid,
  p_display_name text DEFAULT NULL,
  p_email      text DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    email        = COALESCE(p_email,        email),
    phone        = COALESCE(p_phone,        phone),
    updated_at   = now()
  WHERE user_id = p_user_id;
END;
$$;
