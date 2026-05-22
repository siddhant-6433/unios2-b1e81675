CREATE OR REPLACE FUNCTION public.fn_capi_emit_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_capi_relay_post(
    NEW.id,
    'Lead',
    'lead_' || NEW.id::text,
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;
