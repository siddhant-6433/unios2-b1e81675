-- The admin toggle gained Cartesia (and a future plivo option) but the
-- setter's whitelist predated them — clicking Cartesia errored and a stray
-- Sarvam click silently flipped production off the cartesia pipeline.

CREATE OR REPLACE FUNCTION public.set_voice_agent_provider(_provider text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can change the voice agent provider';
  END IF;
  IF _provider NOT IN ('gemini', 'sarvam', 'cartesia', 'plivo') THEN
    RAISE EXCEPTION 'Invalid provider: %. Allowed: gemini, sarvam, cartesia, plivo', _provider;
  END IF;
  UPDATE public._app_config SET value = _provider WHERE key = 'voice_agent_provider';
  IF NOT FOUND THEN
    INSERT INTO public._app_config (key, value) VALUES ('voice_agent_provider', _provider);
  END IF;
  RETURN _provider;
END;
$function$;
