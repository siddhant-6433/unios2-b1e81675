-- Switch ElevenLabs to eleven_v3 + bump style to 0.45 — explicitly
-- requested for "expressive mode + Hinglish". The previous bundled
-- migration only set defaults via COALESCE; this migration always
-- overrides, since the user wants v3 specifically.
--
-- Tradeoff: eleven_v3 is ~30% slower than turbo_v2_5 but renders
-- Hinglish prosody noticeably better (Anjura sounds less robotic on
-- mixed-script utterances). Style 0.45 gives more emotional range
-- without going theatrical.

UPDATE public._app_config
SET value = (
  value::jsonb || jsonb_build_object(
    'elevenlabs_model', 'eleven_v3',
    'elevenlabs_style', 0.45
  )
)::text
WHERE key = 'voice_agent_settings';
