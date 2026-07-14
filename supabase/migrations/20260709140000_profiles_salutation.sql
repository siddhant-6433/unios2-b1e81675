-- Salutation / honorific on user profiles (Mr, Mrs, Dr, Prof, …).
-- Prepended to display_name where a formal name is printed (e.g. the
-- principal signature on a Transfer Certificate).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS salutation text;

-- Extend the admin profile-sync RPC to carry salutation. Drop the old
-- 4-arg signature first so the 5-arg version isn't an ambiguous overload.
DROP FUNCTION IF EXISTS public.admin_update_profile(uuid, text, text, text);

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
  IF NOT has_role(auth.uid(), 'super_admin') THEN
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
