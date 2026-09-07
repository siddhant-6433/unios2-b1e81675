-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712080725 name=profiles_salutation applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS salutation text;

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
