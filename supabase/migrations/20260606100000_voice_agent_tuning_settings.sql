-- Tunable knobs for the voice agent, exposed through the admin UI
-- alongside the existing gemini/sarvam provider toggle. Stored as a JSON
-- blob in _app_config so we can add more knobs later without another
-- migration. The voice-agent (Cloud Run) reads this every 30s through a
-- SYNC cache, same pattern as voice_agent_provider.
--
-- Keys (all optional, with documented defaults if missing):
--   gemini_silence_ms          INT   800-2500   default 1500
--     Gemini Live VAD silenceDurationMs — how long it waits after the
--     last voiced frame before declaring the caller's turn over. Lower =
--     snappier, but too low causes the model to self-interrupt on
--     natural Hindi pauses.
--   sarvam_filler_threshold_ms INT   0-2000     default 700
--     How long after the caller stops speaking before we play a filler
--     ("ji, ek second") while the LLM is still thinking. 0 = always
--     play. 2000 = effectively never play (LLM almost always wins).
--   sarvam_pace                NUM   0.5-2.0    default 1.0
--     Bulbul TTS speed. 1.0 = natural, 1.15 = ~15% faster, 0.9 = slower.
--   sarvam_speaker             TEXT             default "suhani"
--     Bulbul speaker. Validated server-side against an allowlist.
--   sarvam_bulbul_model        TEXT             default "bulbul:v3-beta"
--     Bulbul model variant. Either "bulbul:v3" or "bulbul:v3-beta".

INSERT INTO public._app_config (key, value)
VALUES (
  'voice_agent_settings',
  jsonb_build_object(
    'gemini_silence_ms',          1500,
    'sarvam_filler_threshold_ms', 700,
    'sarvam_pace',                1.0,
    'sarvam_speaker',             'suhani',
    'sarvam_bulbul_model',        'bulbul:v3-beta'
  )::text
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_voice_agent_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (value::jsonb) FROM public._app_config WHERE key = 'voice_agent_settings';
$$;

CREATE OR REPLACE FUNCTION public.set_voice_agent_settings(_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing jsonb;
  v_merged jsonb;
  v_silence int;
  v_filler int;
  v_pace numeric;
  v_speaker text;
  v_model text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can change voice agent settings';
  END IF;

  -- Validate each provided field. Missing fields keep their existing
  -- value (partial updates supported).
  IF _settings ? 'gemini_silence_ms' THEN
    v_silence := (_settings->>'gemini_silence_ms')::int;
    IF v_silence < 500 OR v_silence > 5000 THEN
      RAISE EXCEPTION 'gemini_silence_ms must be 500-5000 (got %)', v_silence;
    END IF;
  END IF;

  IF _settings ? 'sarvam_filler_threshold_ms' THEN
    v_filler := (_settings->>'sarvam_filler_threshold_ms')::int;
    IF v_filler < 0 OR v_filler > 5000 THEN
      RAISE EXCEPTION 'sarvam_filler_threshold_ms must be 0-5000 (got %)', v_filler;
    END IF;
  END IF;

  IF _settings ? 'sarvam_pace' THEN
    v_pace := (_settings->>'sarvam_pace')::numeric;
    IF v_pace < 0.5 OR v_pace > 2.0 THEN
      RAISE EXCEPTION 'sarvam_pace must be 0.5-2.0 (got %)', v_pace;
    END IF;
  END IF;

  IF _settings ? 'sarvam_speaker' THEN
    v_speaker := _settings->>'sarvam_speaker';
    IF v_speaker NOT IN (
      'suhani','anushka','vidya','manisha','shubh',
      'abhilash','arvind','karun','hitesh','meera','pavithra'
    ) THEN
      RAISE EXCEPTION 'sarvam_speaker not in allowlist (got %)', v_speaker;
    END IF;
  END IF;

  IF _settings ? 'sarvam_bulbul_model' THEN
    v_model := _settings->>'sarvam_bulbul_model';
    IF v_model NOT IN ('bulbul:v3','bulbul:v3-beta') THEN
      RAISE EXCEPTION 'sarvam_bulbul_model must be bulbul:v3 or bulbul:v3-beta (got %)', v_model;
    END IF;
  END IF;

  -- Merge into the existing JSON (partial update)
  SELECT (value::jsonb) INTO v_existing FROM public._app_config WHERE key = 'voice_agent_settings';
  IF v_existing IS NULL THEN v_existing := '{}'::jsonb; END IF;
  v_merged := v_existing || _settings;

  UPDATE public._app_config SET value = v_merged::text WHERE key = 'voice_agent_settings';
  IF NOT FOUND THEN
    INSERT INTO public._app_config (key, value) VALUES ('voice_agent_settings', v_merged::text);
  END IF;

  RETURN v_merged;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_voice_agent_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_voice_agent_settings(jsonb) TO authenticated;
