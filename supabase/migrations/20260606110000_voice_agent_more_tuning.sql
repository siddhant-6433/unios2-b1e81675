-- Round 2 of admin-tunable voice-agent settings. Extends the JSONB blob
-- in _app_config.voice_agent_settings — the existing
-- set_voice_agent_settings RPC already does a partial merge, so we just
-- need to (a) add validation for the new fields, (b) backfill defaults
-- onto the existing row.
--
-- New keys (all optional, with documented defaults if missing):
--   gemini_voice               TEXT             default "Aoede"
--     Gemini Live prebuilt voice. One of:
--     Aoede / Charon / Fenrir / Kore / Leda / Puck / Zephyr.
--   gemini_model               TEXT             default "gemini-2.5-flash-native-audio-latest"
--     Gemini Live model. Either the full native-audio model or the
--     half-cascade live preview ("gemini-2.0-flash-live-001").
--   gemini_prefix_padding_ms   INT  100-500     default 300
--     VAD pre-speech audio context window. Rarely needs tuning; lower
--     misses the first phoneme, higher introduces lag.
--   cascade_max_tokens         INT  50-500      default 150
--     Cascade-path LLM maxOutputTokens. Tighter = shorter reply = less
--     LLM + TTS time = lower perceived latency. Too tight cuts replies.
--   cascade_temperature        NUM  0.0-1.5     default 0.4
--     Cascade-path LLM temperature. 0 = deterministic, 0.7+ = creative.
--   cascade_lang_override      TEXT             default "auto"
--     Force Bulbul phonetics: "auto" (script-detect, current),
--     "hi-IN" (always Hindi), or "en-IN" (always English).

-- Backfill defaults onto the existing row so reads always return them.
-- IMPORTANT: cast `::text` AFTER the full jsonb merge — the original
-- version had `jsonb_build_object(...)::text` inside, which made the `||`
-- a text-concatenation instead of a JSON merge and produced a corrupted
-- `{json}{json}` value. Fixed in place; if you ever rerun this from a
-- fresh DB the merge now works correctly.
UPDATE public._app_config
SET value = (
  COALESCE(value::jsonb, '{}'::jsonb) || jsonb_build_object(
    'gemini_voice',             COALESCE(value::jsonb->>'gemini_voice',             'Aoede'),
    'gemini_model',             COALESCE(value::jsonb->>'gemini_model',             'gemini-2.5-flash-native-audio-latest'),
    'gemini_prefix_padding_ms', COALESCE((value::jsonb->>'gemini_prefix_padding_ms')::int, 300),
    'cascade_max_tokens',       COALESCE((value::jsonb->>'cascade_max_tokens')::int, 150),
    'cascade_temperature',      COALESCE((value::jsonb->>'cascade_temperature')::numeric, 0.4),
    'cascade_lang_override',    COALESCE(value::jsonb->>'cascade_lang_override',    'auto')
  )
)::text
WHERE key = 'voice_agent_settings';

-- Replace the setter to validate the new fields too. (Existing fields'
-- validation is preserved verbatim so the partial-merge contract holds.)
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
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can change voice agent settings';
  END IF;

  -- Round-1 fields (unchanged validation)
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

  -- Round-2 fields (new)
  IF _settings ? 'gemini_voice' THEN
    v_voice := _settings->>'gemini_voice';
    IF v_voice NOT IN ('Aoede','Charon','Fenrir','Kore','Leda','Puck','Zephyr') THEN
      RAISE EXCEPTION 'gemini_voice must be one of Aoede/Charon/Fenrir/Kore/Leda/Puck/Zephyr (got %)', v_voice;
    END IF;
  END IF;
  IF _settings ? 'gemini_model' THEN
    v_gemini_model := _settings->>'gemini_model';
    IF v_gemini_model NOT IN (
      'gemini-2.5-flash-native-audio-latest',
      'gemini-2.5-flash-preview-native-audio-dialog',
      'gemini-2.0-flash-live-001'
    ) THEN
      RAISE EXCEPTION 'gemini_model not in allowlist (got %)', v_gemini_model;
    END IF;
  END IF;
  IF _settings ? 'gemini_prefix_padding_ms' THEN
    v_prefix_pad := (_settings->>'gemini_prefix_padding_ms')::int;
    IF v_prefix_pad < 50 OR v_prefix_pad > 1000 THEN
      RAISE EXCEPTION 'gemini_prefix_padding_ms must be 50-1000 (got %)', v_prefix_pad;
    END IF;
  END IF;
  IF _settings ? 'cascade_max_tokens' THEN
    v_max_tokens := (_settings->>'cascade_max_tokens')::int;
    IF v_max_tokens < 30 OR v_max_tokens > 800 THEN
      RAISE EXCEPTION 'cascade_max_tokens must be 30-800 (got %)', v_max_tokens;
    END IF;
  END IF;
  IF _settings ? 'cascade_temperature' THEN
    v_temperature := (_settings->>'cascade_temperature')::numeric;
    IF v_temperature < 0 OR v_temperature > 2 THEN
      RAISE EXCEPTION 'cascade_temperature must be 0-2 (got %)', v_temperature;
    END IF;
  END IF;
  IF _settings ? 'cascade_lang_override' THEN
    v_lang := _settings->>'cascade_lang_override';
    IF v_lang NOT IN ('auto','hi-IN','en-IN') THEN
      RAISE EXCEPTION 'cascade_lang_override must be auto/hi-IN/en-IN (got %)', v_lang;
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
