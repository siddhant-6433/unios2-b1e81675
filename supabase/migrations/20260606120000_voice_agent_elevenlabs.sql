-- Add ElevenLabs as a cascade TTS option alongside Sarvam Bulbul.
--
-- Two new settings on _app_config.voice_agent_settings:
--   cascade_tts_provider TEXT  default "sarvam"
--     Which TTS engine the cascade uses. "sarvam" (Bulbul) or "elevenlabs".
--   elevenlabs_voice_id  TEXT  default ""
--     Voice ID from the admin's ElevenLabs dashboard. Required when
--     cascade_tts_provider="elevenlabs". Empty value falls back to
--     Sarvam to avoid silent failures.

UPDATE public._app_config
SET value = (
  COALESCE(value::jsonb, '{}'::jsonb) || jsonb_build_object(
    'cascade_tts_provider', COALESCE(value::jsonb->>'cascade_tts_provider', 'sarvam'),
    'elevenlabs_voice_id',  COALESCE(value::jsonb->>'elevenlabs_voice_id', '')
  )
)::text
WHERE key = 'voice_agent_settings';

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
  v_voice text;
  v_gemini_model text;
  v_prefix_pad int;
  v_max_tokens int;
  v_temperature numeric;
  v_lang text;
  v_tts_provider text;
  v_eleven_voice text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can change voice agent settings';
  END IF;

  -- Existing fields (validation unchanged)
  IF _settings ? 'gemini_silence_ms' THEN
    v_silence := (_settings->>'gemini_silence_ms')::int;
    IF v_silence < 500 OR v_silence > 5000 THEN RAISE EXCEPTION 'gemini_silence_ms must be 500-5000 (got %)', v_silence; END IF;
  END IF;
  IF _settings ? 'sarvam_filler_threshold_ms' THEN
    v_filler := (_settings->>'sarvam_filler_threshold_ms')::int;
    IF v_filler < 0 OR v_filler > 5000 THEN RAISE EXCEPTION 'sarvam_filler_threshold_ms must be 0-5000 (got %)', v_filler; END IF;
  END IF;
  IF _settings ? 'sarvam_pace' THEN
    v_pace := (_settings->>'sarvam_pace')::numeric;
    IF v_pace < 0.5 OR v_pace > 2.0 THEN RAISE EXCEPTION 'sarvam_pace must be 0.5-2.0 (got %)', v_pace; END IF;
  END IF;
  IF _settings ? 'sarvam_speaker' THEN
    v_speaker := _settings->>'sarvam_speaker';
    IF v_speaker NOT IN ('suhani','anushka','vidya','manisha','shubh','abhilash','arvind','karun','hitesh','meera','pavithra')
      THEN RAISE EXCEPTION 'sarvam_speaker not in allowlist (got %)', v_speaker; END IF;
  END IF;
  IF _settings ? 'sarvam_bulbul_model' THEN
    v_model := _settings->>'sarvam_bulbul_model';
    IF v_model NOT IN ('bulbul:v3','bulbul:v3-beta') THEN RAISE EXCEPTION 'sarvam_bulbul_model invalid (got %)', v_model; END IF;
  END IF;
  IF _settings ? 'gemini_voice' THEN
    v_voice := _settings->>'gemini_voice';
    IF v_voice NOT IN ('Aoede','Charon','Fenrir','Kore','Leda','Puck','Zephyr')
      THEN RAISE EXCEPTION 'gemini_voice invalid (got %)', v_voice; END IF;
  END IF;
  IF _settings ? 'gemini_model' THEN
    v_gemini_model := _settings->>'gemini_model';
    IF v_gemini_model NOT IN ('gemini-2.5-flash-native-audio-latest','gemini-2.5-flash-preview-native-audio-dialog','gemini-2.0-flash-live-001')
      THEN RAISE EXCEPTION 'gemini_model invalid (got %)', v_gemini_model; END IF;
  END IF;
  IF _settings ? 'gemini_prefix_padding_ms' THEN
    v_prefix_pad := (_settings->>'gemini_prefix_padding_ms')::int;
    IF v_prefix_pad < 50 OR v_prefix_pad > 1000 THEN RAISE EXCEPTION 'gemini_prefix_padding_ms must be 50-1000 (got %)', v_prefix_pad; END IF;
  END IF;
  IF _settings ? 'cascade_max_tokens' THEN
    v_max_tokens := (_settings->>'cascade_max_tokens')::int;
    IF v_max_tokens < 30 OR v_max_tokens > 800 THEN RAISE EXCEPTION 'cascade_max_tokens must be 30-800 (got %)', v_max_tokens; END IF;
  END IF;
  IF _settings ? 'cascade_temperature' THEN
    v_temperature := (_settings->>'cascade_temperature')::numeric;
    IF v_temperature < 0 OR v_temperature > 2 THEN RAISE EXCEPTION 'cascade_temperature must be 0-2 (got %)', v_temperature; END IF;
  END IF;
  IF _settings ? 'cascade_lang_override' THEN
    v_lang := _settings->>'cascade_lang_override';
    IF v_lang NOT IN ('auto','hi-IN','en-IN') THEN RAISE EXCEPTION 'cascade_lang_override must be auto/hi-IN/en-IN (got %)', v_lang; END IF;
  END IF;

  -- New (Round 3)
  IF _settings ? 'cascade_tts_provider' THEN
    v_tts_provider := _settings->>'cascade_tts_provider';
    IF v_tts_provider NOT IN ('sarvam','elevenlabs') THEN
      RAISE EXCEPTION 'cascade_tts_provider must be sarvam or elevenlabs (got %)', v_tts_provider;
    END IF;
  END IF;
  IF _settings ? 'elevenlabs_voice_id' THEN
    v_eleven_voice := _settings->>'elevenlabs_voice_id';
    -- Allow empty string (user clearing the value), else require ≥10 chars
    IF length(v_eleven_voice) BETWEEN 1 AND 9 THEN
      RAISE EXCEPTION 'elevenlabs_voice_id looks malformed (got %)', v_eleven_voice;
    END IF;
  END IF;

  -- Merge into existing
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
