-- Dashboard-controlled toggle for the voice agent backend.
-- The voice-agent (Cloud Run) reads this on every WebSocket connect to
-- decide whether the AI call uses:
--   - 'gemini': Gemini Live native-audio (default — proven path)
--   - 'sarvam': Cascaded Sarvam STT → Gemini text → Sarvam TTS
--
-- Switching is instant; the in-memory cache in voice-agent has a 30s TTL.
--
-- _app_config stays locked from authenticated callers because it also
-- holds service_role_key / supabase_url. Admins flip the toggle via the
-- two SECURITY DEFINER RPCs below — one read, one write — restricted to
-- super_admin so a counsellor can't accidentally swap engines.

INSERT INTO public._app_config (key, value)
VALUES ('voice_agent_provider', 'gemini')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_voice_agent_provider()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value FROM public._app_config WHERE key = 'voice_agent_provider';
$$;

CREATE OR REPLACE FUNCTION public.set_voice_agent_provider(_provider text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can change the voice agent provider';
  END IF;
  IF _provider NOT IN ('gemini', 'sarvam') THEN
    RAISE EXCEPTION 'Invalid provider: %. Allowed: gemini, sarvam', _provider;
  END IF;
  UPDATE public._app_config SET value = _provider WHERE key = 'voice_agent_provider';
  IF NOT FOUND THEN
    INSERT INTO public._app_config (key, value) VALUES ('voice_agent_provider', _provider);
  END IF;
  RETURN _provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_voice_agent_provider() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_voice_agent_provider(text) TO authenticated;
